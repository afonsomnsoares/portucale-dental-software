import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appendAudit, appendTimeline } from './audit';
import type { SessionUser } from './auth';
import { canAutoContact } from './commPrefs';
import { query, queryOne } from './db';
import { generateReorderSuggestions } from './inventory';
import { computeLifecycleTransitions, markLifecycleOutreachSent } from './lifecycle';
import { createTask } from './patientTasks';
import { saveRecoverySnapshot } from './recovery';
import { computeUpcomingRisk } from './scheduleIntel';
import { toE164 } from './validate';
import { expireStaleOffers, findCandidates } from './waitlist';

// Shared job-orchestration logic for the background pipeline (reminders, risk scoring,
// proactive outreach, notification sending, cleanup). Both the admin-triggered HTTP
// route (app/api/jobs/run/route.ts, one tenant at a time, on demand) and the unattended
// cron script (scripts/run-jobs.ts, all active tenants, on a timer) call runJob() below
// so the logic itself only lives in one place.

const RISK_OUTREACH_LEAD_DAYS = 3;
const RISK_OUTREACH_THRESHOLD = 60;
// How long to wait before re-nagging the same overdue recall if the patient hasn't
// responded (and hasn't booked) — same rolling-cooldown idea as
// lib/lifecycleCalc.ts's REACTIVATION_COOLDOWN_DAYS, just shorter: a recall is a
// concrete "you're due" fact the patient already agreed to at some point (unlike
// lifecycle reactivation, which is a colder re-engagement attempt), so it's reasonable
// to follow up more often.
const RECALL_OUTREACH_COOLDOWN_DAYS = 14;
// How many patients on the waitlist to surface as a proactive standby shortlist per
// high-risk appointment — same cap as MAX_OFFERS_PER_SLOT in lib/waitlist.ts, so a
// receptionist never sees more names than they'd actually be offered the slot.
const STANDBY_CANDIDATES_LIMIT = 3;
// A plan sits unapproved for at least this long before the first follow-up nudge — long
// enough that "still deciding" and "forgot about it" are distinguishable.
const PLAN_FOLLOWUP_THRESHOLD_DAYS = 7;
// Re-nagging cadence once the first follow-up has gone out, same idea as
// RECALL_OUTREACH_COOLDOWN_DAYS.
const PLAN_FOLLOWUP_COOLDOWN_DAYS = 10;
// Item 12 — "escalamento para responsáveis": an unassigned high/critical incident sits
// this long before it turns into a task somebody has to actually look at.
const INCIDENT_ESCALATION_HOURS = 4;
// Item 12 — "acompanhamento de tarefas": how late in the day an opening/closing
// checklist can go un-started before it's worth nagging about. 'other'-type templates
// use the closing hour too — there's no natural time-of-day default for them.
const CHECKLIST_REMINDER_HOUR: Record<string, number> = { opening: 10, closing: 20, other: 20 };

// Used when a job runs without a human behind it (the cron script) — the audit trail and
// patient timeline still need *some* actor, same pattern already used for the SMS
// send confirmation in sendDueNotifications below.
export const SYSTEM_ACTOR: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = {
  id: '',
  name: 'System Cron',
  // Just a label written into audit_log/patient_timeline's free-text user_role column
  // (not checked against users.role's CHECK constraint or any permission gate) — 'system'
  // is clearer than borrowing 'admin'/'super_admin' for something that is neither.
  role: 'system',
  clinic: 'System',
};

export const JOB_NAMES = [
  'reminders',
  'risk',
  'riskOutreach',
  'lifecycleOutreach',
  'recallOutreach',
  'planFollowup',
  'escalateIncidents',
  'checklistReminders',
  'send',
  'waitlistExpire',
  'retention',
  'summary',
  'recovery',
  'reorderSuggestions',
] as const;
export type JobName = (typeof JOB_NAMES)[number] | 'all';

function computeNextRetry(attempts: number) {
  const base = 5 * 60 * 1000;
  const delay = base * Math.min(64, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delay).toISOString();
}

// Sends a plain-text SMS via the Twilio REST API. Unlike WhatsApp Business, Twilio needs
// no pre-approved message templates, so callers just pass the final message body — see
// the queue*() functions below for where that text is composed.
async function sendSms({ to, body }: { to: string; body: string }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error: 'SMS provider not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).',
    };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: data?.message || `SMS error (${res.status})` };
  }
  const msgId = data?.sid || null;
  return { ok: true, id: msgId };
}

async function logJobRun(jobName: string, status: string, details: Record<string, unknown>) {
  const [row] = await query(`INSERT INTO job_runs (job_name, status, details) VALUES ($1,$2,$3::jsonb) RETURNING *`, [
    jobName,
    status,
    JSON.stringify(details || {}),
  ]);
  return row;
}

async function queueAppointmentReminders(tenantId: string) {
  const rows = await query(
    `SELECT a.id as appointment_id, a.patient_id, a.appt_date, a.start_time, a.type,
            p.name as patient_name, p.phone as patient_phone, p.comm_prefs,
            t.name as tenant_name
     FROM appointments a
     JOIN patients p ON p.id=a.patient_id
     JOIN tenants t ON t.id=a.tenant_id
     WHERE a.tenant_id=$1
       AND a.appt_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '2 days')::date
       AND a.status IN ('confirmed','registered','waiting')`,
    [tenantId],
  );

  let queued = 0;
  for (const r of rows) {
    // Respect an explicit "don't SMS me" (see lib/commPrefs.ts) — applies to every
    // automated queue*() function below, not a one-off check here.
    const phone = canAutoContact(r.comm_prefs, 'sms') ? toE164(r.patient_phone) : '';
    if (!phone) continue;
    const exists = await queryOne(
      `SELECT 1 FROM notifications
       WHERE tenant_id=$1 AND appointment_id=$2 AND channel='sms'
         AND payload->>'kind'='appointment_reminder'
       LIMIT 1`,
      [tenantId, r.appointment_id],
    );
    if (exists) continue;

    const date = String(r.appt_date).slice(0, 10);
    const time = String(r.start_time).slice(0, 5);
    const body = `Olá ${r.patient_name}, lembramos da sua consulta em ${r.tenant_name} no dia ${date} às ${time} (${r.type}). Para remarcar, contacte-nos.`;
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, appointment_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,$3,'sms',$4,$5::jsonb,'queued',NOW())`,
      [tenantId, r.patient_id, r.appointment_id, phone, JSON.stringify({ kind: 'appointment_reminder', body })],
    );
    queued += 1;
  }
  return { queued, scanned: rows.length };
}

// Proactive side of schedule-intel: for appointments the risk engine flagged as high-risk
// and happening within RISK_OUTREACH_LEAD_DAYS, queue an SMS confirmation ask (distinct
// from the plain reminder) so the receptionist can react before a no-show happens, not
// after. Also attaches a read-only "standby" shortlist from the waitlist for each one —
// "procurar substituto" preventively, before anything is actually freed up: the offer
// itself only ever fires for real once the slot is genuinely cancelled/no-shown (see
// lib/waitlist.ts's notifyWaitlistOfFreedSlot), this is just so reception already knows
// who to call the moment that happens.
async function queueRiskOutreach(tenantId: string) {
  const { scored } = await computeUpcomingRisk(tenantId, RISK_OUTREACH_LEAD_DAYS);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  const candidates = scored.filter((s) => s.score >= RISK_OUTREACH_THRESHOLD);
  if (!candidates.length) return { queued: 0, scanned: 0 };

  const apptIds = candidates.map((a) => a.id);
  const [apptDetails, patients] = await Promise.all([
    query(`SELECT id, dentist_id, chair, duration FROM appointments WHERE id = ANY($1::uuid[])`, [apptIds]),
    query(`SELECT id, comm_prefs FROM patients WHERE id = ANY($1::uuid[])`, [candidates.map((a) => a.patient_id)]),
  ]);
  const apptById = new Map(apptDetails.map((d) => [String(d.id), d]));
  const commPrefsByPatient = new Map(patients.map((p) => [String(p.id), p.comm_prefs]));

  let queued = 0;
  for (const a of candidates) {
    const phone = canAutoContact(commPrefsByPatient.get(String(a.patient_id)), 'sms') ? toE164(a.phone) : '';
    if (!phone) continue;
    const exists = await queryOne(
      `SELECT 1 FROM notifications
       WHERE tenant_id=$1 AND appointment_id=$2 AND channel='sms'
         AND payload->>'kind'='risk_outreach'
       LIMIT 1`,
      [tenantId, a.id],
    );
    if (exists) continue;

    const date = String(a.appt_date).slice(0, 10);
    const time = String(a.start_time).slice(0, 5);
    const body = `Olá ${a.patient_name}, confirma a sua consulta em ${tenant?.name || ''} no dia ${date} às ${time} (${a.type})? Responda SIM para confirmar ou contacte-nos para remarcar.`;

    const detail = apptById.get(String(a.id));
    let standbyCandidates: Array<{ patientId: string; name: string; phone: string | null }> = [];
    if (detail) {
      const ranked = await findCandidates(
        tenantId,
        {
          date,
          startTime: time,
          type: a.type,
          duration: Number(detail.duration) || 30,
          dentistId: detail.dentist_id || null,
          chair: Number(detail.chair) || 1,
        },
        STANDBY_CANDIDATES_LIMIT,
      );
      if (ranked.length) {
        const standbyPatients = await query(`SELECT id, name, phone FROM patients WHERE id = ANY($1::uuid[])`, [
          ranked.map((c) => c.patient_id),
        ]);
        const byId = new Map(standbyPatients.map((p) => [String(p.id), p]));
        standbyCandidates = ranked.map((c) => ({
          patientId: c.patient_id,
          name: String(byId.get(c.patient_id)?.name || ''),
          phone: byId.get(c.patient_id)?.phone || null,
        }));
      }
    }

    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, appointment_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,$3,'sms',$4,$5::jsonb,'queued',NOW())`,
      [tenantId, a.patient_id, a.id, phone, JSON.stringify({ kind: 'risk_outreach', body, standbyCandidates })],
    );
    queued += 1;
  }
  return { queued, scanned: candidates.length };
}

// Proactive side of the Patient Lifecycle engine (lib/lifecycle.ts): finds patients who
// are currently 'inactive', have given marketing-outreach consent, and are past the
// reactivation cooldown, then queues an SMS re-engagement message for each — the
// piece that turns lifecycle staging from a read-only classification into an actual
// re-engagement loop. Booking the resulting appointment is still done by the
// receptionist once the patient replies, same as waitlist offers.
async function queueLifecycleOutreach(tenantId: string) {
  const { transitions, outreachCandidates } = await computeLifecycleTransitions(tenantId);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);

  let queued = 0;
  for (const c of outreachCandidates) {
    const phone = canAutoContact(c.commPrefs, 'sms') ? toE164(c.phone) : '';
    if (!phone) continue;
    const body = `Olá ${c.name}, já não o vemos em ${tenant?.name || ''} há algum tempo. Contacte-nos para remarcar a sua consulta.`;
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())`,
      [tenantId, c.patientId, phone, JSON.stringify({ kind: 'lifecycle_reactivation', body, segment: c.segment })],
    );
    await markLifecycleOutreachSent(tenantId, c.patientId);
    queued += 1;
  }
  return { transitions: transitions.length, candidates: outreachCandidates.length, queued };
}

// Turns an overdue `recalls` row into an actual SMS instead of just sitting in the
// Recuperação/Jornada lists waiting for a human to notice it. Unlike
// queueLifecycleOutreach (marketing re-engagement, gated on patient_data_consents), a
// recall reminder is treated as a service/appointment-adjacent message — the same
// category as queueAppointmentReminders — since it's telling a patient about care they
// (or their dentist) already scheduled a cadence for, not soliciting them cold.
//
// Stops itself two ways: `NOT EXISTS (future appointment)` means a patient who already
// rebooked (by phone, in person, or after replying to this very SMS) drops out of the
// candidate list on the very next run — satisfies "parar comunicação quando o paciente
// marca" without any extra bookkeeping. `last_notified_at` + the cooldown keeps it from
// re-sending every time the job runs for those who haven't answered yet.
async function queueRecallOutreach(tenantId: string) {
  const rows = await query(
    `SELECT r.id, r.patient_id, r.recall_type, r.next_due, p.name AS patient_name, p.phone, p.comm_prefs
     FROM recalls r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.tenant_id=$1 AND r.active=TRUE AND r.next_due <= CURRENT_DATE
       AND (r.last_notified_at IS NULL OR r.last_notified_at < NOW() - ($2::int * INTERVAL '1 day'))
       AND NOT EXISTS (
         SELECT 1 FROM appointments a
         WHERE a.patient_id = r.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
       )`,
    [tenantId, RECALL_OUTREACH_COOLDOWN_DAYS],
  );
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);

  let queued = 0;
  for (const r of rows) {
    const phone = canAutoContact(r.comm_prefs, 'sms') ? toE164(r.phone) : '';
    if (!phone) continue;
    const body = `Olá ${r.patient_name}, está na altura de marcar a sua consulta de ${r.recall_type} em ${tenant?.name || ''}. Contacte-nos para agendar.`;
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())`,
      [tenantId, r.patient_id, phone, JSON.stringify({ kind: 'recall_reminder', body, recallId: r.id })],
    );
    await query(`UPDATE recalls SET last_notified_at=NOW() WHERE id=$1`, [r.id]);
    queued += 1;
  }
  return { queued, scanned: rows.length };
}

// Item 6 (Tratamentos e Conversão) / item 5's own example: "consulta há 14 dias + plano
// apresentado + não marcou → follow-up automático". A treatment_plans row that's still
// `approved=false` after PLAN_FOLLOWUP_THRESHOLD_DAYS gets a nudge SMS. Stops itself the
// same way queueRecallOutreach does: once the plan is approved (or cancelled) it simply
// stops matching this WHERE clause on the next run — no separate "cancel the outreach"
// bookkeeping needed. Cooldown is checked against `notifications` directly (by
// payload->>'planId') instead of a new last_notified_at column, since nothing else needs
// one on treatment_plans.
async function queuePlanFollowup(tenantId: string) {
  const rows = await query(
    `SELECT tp.id, tp.patient_id, tp.title, tp.total_fee, p.name AS patient_name, p.phone, p.comm_prefs
     FROM treatment_plans tp
     JOIN patients p ON p.id = tp.patient_id
     WHERE tp.tenant_id=$1 AND tp.approved=FALSE AND tp.status <> 'cancelled'
       AND tp.created_at <= NOW() - ($2::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.tenant_id=$1 AND n.payload->>'kind'='plan_followup' AND n.payload->>'planId'=tp.id::text
           AND n.created_at > NOW() - ($3::int * INTERVAL '1 day')
       )`,
    [tenantId, PLAN_FOLLOWUP_THRESHOLD_DAYS, PLAN_FOLLOWUP_COOLDOWN_DAYS],
  );
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);

  let queued = 0;
  for (const r of rows) {
    const phone = canAutoContact(r.comm_prefs, 'sms') ? toE164(r.phone) : '';
    if (!phone) continue;
    const body = `Olá ${r.patient_name}, ainda não recebemos a sua decisão sobre o plano de tratamento "${r.title}" em ${tenant?.name || ''}. Contacte-nos com qualquer dúvida ou para avançar.`;
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())`,
      [
        tenantId,
        r.patient_id,
        phone,
        JSON.stringify({ kind: 'plan_followup', body, planId: r.id, planValue: Number(r.total_fee || 0) }),
      ],
    );
    queued += 1;
  }
  return { queued, scanned: rows.length };
}

// Item 12 — "escalamento para responsáveis": a high/critical incident nobody has claimed
// (assigned_to IS NULL) after INCIDENT_ESCALATION_HOURS turns into a patient_tasks entry
// in the team queue (patient_id NULL — already a supported "internal, not patient-tied"
// task, see 018_patient_tasks.sql) so it surfaces in the same tasks queue the rest of the
// team already checks, instead of only being visible to whoever thinks to filter
// Operações by severity. No SMS here — incidents aren't about a patient to text.
//
// Stops re-escalating the same incident while its task is still open (`notes` carries a
// stable `incident:<id>` marker, checked via NOT EXISTS) — once resolved/assigned it
// drops out of the WHERE clause entirely on the next run, same "recompute fresh every
// time" idiom as the rest of this file.
async function escalateIncidents(tenantId: string) {
  const rows = await query(
    `SELECT id, title, severity FROM incidents
     WHERE tenant_id=$1 AND status='open' AND assigned_to IS NULL AND severity IN ('high','critical')
       AND created_at <= NOW() - ($2::int * INTERVAL '1 hour')
       AND NOT EXISTS (
         SELECT 1 FROM patient_tasks pt
         WHERE pt.tenant_id=$1 AND pt.notes = ('incident:' || incidents.id::text) AND pt.status='pending'
       )`,
    [tenantId, INCIDENT_ESCALATION_HOURS],
  );

  let escalated = 0;
  for (const r of rows) {
    await createTask(tenantId, SYSTEM_ACTOR.id || null, {
      patientId: null,
      type: 'follow_up',
      title: `Incidente ${r.severity} por atribuir: ${r.title}`,
      notes: `incident:${r.id}`,
    });
    escalated += 1;
  }
  return { escalated, scanned: rows.length };
}

// Item 12 — "acompanhamento de tarefas": an active checklist template with no run started
// yet today, past its expected time of day, becomes a reminder task the same way an
// escalated incident does. Stops itself the moment anyone starts today's run (the
// `NOT EXISTS (checklist_runs ...)` clause simply stops matching), and never repeats for
// the same template+day (`checklist:<templateId>:<date>` marker, same idiom as incidents
// above).
async function checklistReminders(tenantId: string) {
  const rows = await query(
    `SELECT ct.id, ct.name, ct.type
     FROM checklist_templates ct
     WHERE ct.tenant_id=$1 AND ct.active=TRUE
       AND EXTRACT(HOUR FROM NOW()) >= CASE ct.type
             WHEN 'opening' THEN $2::int WHEN 'closing' THEN $3::int ELSE $4::int END
       AND NOT EXISTS (SELECT 1 FROM checklist_runs cr WHERE cr.template_id=ct.id AND cr.run_date=CURRENT_DATE)
       AND NOT EXISTS (
         SELECT 1 FROM patient_tasks pt
         WHERE pt.tenant_id=$1 AND pt.notes = ('checklist:' || ct.id::text || ':' || CURRENT_DATE::text)
           AND pt.status <> 'cancelled'
       )`,
    [tenantId, CHECKLIST_REMINDER_HOUR.opening, CHECKLIST_REMINDER_HOUR.closing, CHECKLIST_REMINDER_HOUR.other],
  );

  let queued = 0;
  for (const r of rows) {
    await createTask(tenantId, SYSTEM_ACTOR.id || null, {
      patientId: null,
      type: 'follow_up',
      title: `Checklist por iniciar: ${r.name}`,
      notes: `checklist:${r.id}:${new Date().toLocaleDateString('en-CA')}`,
    });
    queued += 1;
  }
  return { queued, scanned: rows.length };
}

async function sendDueNotifications(tenantId: string, limit = 25) {
  const rows = await query(
    `SELECT * FROM notifications
     WHERE tenant_id=$1
       AND status IN ('queued','retry')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at
     LIMIT $2`,
    [tenantId, limit],
  );

  let sent = 0;
  let failed = 0;
  for (const n of rows) {
    const payload = n.payload || {};
    const phone = String(n.to_addr || '');
    const body = String(payload.body || '');

    const result = await sendSms({ to: phone, body });
    if (result.ok) {
      await query(
        `UPDATE notifications
         SET status='sent', provider_id=$1, sent_at=NOW(), attempts=attempts+1, last_error=NULL
         WHERE id=$2`,
        [result.id, n.id],
      );
      await appendTimeline(
        n.patient_id,
        { name: 'System', role: 'system' },
        'admin',
        `Notificação enviada (SMS): ${payload.kind || 'unknown'}`,
      );
      sent += 1;
    } else {
      const nextRetry = computeNextRetry(Number(n.attempts || 0) + 1);
      const nextStatus = Number(n.attempts || 0) + 1 >= 5 ? 'failed' : 'retry';
      await query(
        `UPDATE notifications
         SET status=$1, attempts=attempts+1, last_error=$2, next_retry_at=$3::timestamptz
         WHERE id=$4`,
        [nextStatus, result.error || 'Send failed', nextRetry, n.id],
      );
      failed += 1;
    }
  }
  return { processed: rows.length, sent, failed };
}

async function cleanupUploads() {
  const expired = await query(
    `SELECT id, storage, storage_key FROM uploads
     WHERE storage='local' AND expires_at IS NOT NULL AND expires_at < NOW()
     ORDER BY expires_at
     LIMIT 500`,
  );
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  let removed = 0;
  for (const u of expired) {
    try {
      await unlink(path.join(uploadsDir, u.storage_key));
    } catch {}
    await query(`DELETE FROM uploads WHERE id=$1`, [u.id]);
    removed += 1;
  }

  const days = Number(process.env.UPLOAD_RETENTION_DAYS || 90);
  const cutoff = Date.now() - (Number.isFinite(days) && days > 0 ? days * 86400000 : 90 * 86400000);
  let scanned = 0;
  let swept = 0;
  try {
    const files = await readdir(uploadsDir).catch(() => []);
    for (const f of files) {
      scanned += 1;
      const full = path.join(uploadsDir, f);
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      if (st.isFile() && st.mtimeMs < cutoff) {
        await unlink(full).catch(() => {});
        swept += 1;
      }
    }
  } catch {}

  return { removed, scanned, swept };
}

async function nightlySummary(tenantId: string) {
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const apptCounts = await queryOne(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='no-show')::int AS no_show
     FROM appointments WHERE tenant_id=$1 AND appt_date=$2::date`,
    [tenantId, y],
  );
  const revenue = await queryOne(
    `SELECT COALESCE(SUM(paid),0)::numeric AS revenue
     FROM invoices WHERE tenant_id=$1 AND invoice_date=$2::date`,
    [tenantId, y],
  );
  return {
    day: y,
    appointments: Number(apptCounts.total || 0),
    noShows: Number(apptCounts.no_show || 0),
    revenue: Number(revenue.revenue || 0),
  };
}

// Runs one job (or 'all' of them) for a single tenant and records it — used by both the
// admin-triggered HTTP route and the unattended cron script. `actor` identifies who/what
// triggered the run for the audit log; defaults to SYSTEM_ACTOR for unattended callers.
export async function runJob(
  tenantId: string,
  job: JobName = 'all',
  actor: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = SYSTEM_ACTOR,
) {
  const details: Record<string, unknown> = {};
  try {
    if (job === 'all' || job === 'reminders') {
      details.appointmentReminders = await queueAppointmentReminders(tenantId);
    }
    if (job === 'all' || job === 'risk') {
      const { scored, highRisk } = await computeUpcomingRisk(tenantId);
      details.risk = { scored: scored.length, highRisk: highRisk.length };
    }
    if (job === 'all' || job === 'riskOutreach') {
      details.riskOutreach = await queueRiskOutreach(tenantId);
    }
    if (job === 'all' || job === 'lifecycleOutreach') {
      details.lifecycleOutreach = await queueLifecycleOutreach(tenantId);
    }
    if (job === 'all' || job === 'recallOutreach') {
      details.recallOutreach = await queueRecallOutreach(tenantId);
    }
    if (job === 'all' || job === 'planFollowup') {
      details.planFollowup = await queuePlanFollowup(tenantId);
    }
    if (job === 'all' || job === 'escalateIncidents') {
      details.escalateIncidents = await escalateIncidents(tenantId);
    }
    if (job === 'all' || job === 'checklistReminders') {
      details.checklistReminders = await checklistReminders(tenantId);
    }
    if (job === 'all' || job === 'send') {
      details.send = await sendDueNotifications(tenantId, 50);
    }
    if (job === 'all' || job === 'waitlistExpire') {
      details.waitlistExpire = await expireStaleOffers(tenantId);
    }
    if (job === 'all' || job === 'retention') {
      details.retention = await cleanupUploads();
    }
    if (job === 'all' || job === 'summary') {
      details.summary = await nightlySummary(tenantId);
    }
    if (job === 'all' || job === 'recovery') {
      details.recoverySnapshot = await saveRecoverySnapshot(tenantId, actor.id || null);
    }
    if (job === 'all' || job === 'reorderSuggestions') {
      details.reorderSuggestions = await generateReorderSuggestions(tenantId);
    }
    await logJobRun(job, 'completed', details);
    await appendAudit(actor, 'UPDATE', `Jobs run: ${job}`, null, 'completed', actor.clinic);
    return { ok: true as const, job, tenantId, details };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logJobRun(job, 'failed', { error: message });
    return { ok: false as const, job, tenantId, error: message || 'Job failed' };
  }
}

export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await query(`SELECT id FROM tenants WHERE status='active' ORDER BY name`);
  return rows.map((r) => String(r.id));
}
