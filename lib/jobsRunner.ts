import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appendAudit, appendTimeline } from './audit';
import type { SessionUser } from './auth';
import { query, queryOne } from './db';
import { computeLifecycleTransitions, markLifecycleOutreachSent } from './lifecycle';
import { saveRecoverySnapshot } from './recovery';
import { computeUpcomingRisk } from './scheduleIntel';
import { toE164 } from './validate';
import { expireStaleOffers } from './waitlist';

// Shared job-orchestration logic for the background pipeline (reminders, risk scoring,
// proactive outreach, notification sending, cleanup). Both the admin-triggered HTTP
// route (app/api/jobs/run/route.ts, one tenant at a time, on demand) and the unattended
// cron script (scripts/run-jobs.ts, all active tenants, on a timer) call runJob() below
// so the logic itself only lives in one place.

const RISK_OUTREACH_LEAD_DAYS = 3;
const RISK_OUTREACH_THRESHOLD = 60;

// Used when a job runs without a human behind it (the cron script) — the audit trail and
// patient timeline still need *some* actor, same pattern already used for the SMS
// send confirmation in sendDueNotifications below.
export const SYSTEM_ACTOR: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = {
  id: '',
  name: 'System Cron',
  role: 'admin',
  clinic: 'System',
};

export const JOB_NAMES = [
  'reminders',
  'risk',
  'riskOutreach',
  'lifecycleOutreach',
  'send',
  'waitlistExpire',
  'retention',
  'summary',
  'recovery',
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
            p.name as patient_name, p.phone as patient_phone,
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
    const phone = toE164(r.patient_phone);
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
// from the plain reminder) so the receptionist can react before a no-show happens, not after.
async function queueRiskOutreach(tenantId: string) {
  const { scored } = await computeUpcomingRisk(tenantId, RISK_OUTREACH_LEAD_DAYS);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);

  let queued = 0;
  const candidates = scored.filter((s) => s.score >= RISK_OUTREACH_THRESHOLD);
  for (const a of candidates) {
    const phone = toE164(a.phone);
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
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, appointment_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,$3,'sms',$4,$5::jsonb,'queued',NOW())`,
      [tenantId, a.patient_id, a.id, phone, JSON.stringify({ kind: 'risk_outreach', body })],
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
    const phone = toE164(c.phone);
    if (!phone) continue;
    const body = `Olá ${c.name}, já não o vemos em ${tenant?.name || ''} há algum tempo. Contacte-nos para remarcar a sua consulta.`;
    await query(
      `INSERT INTO notifications
         (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
       VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())`,
      [tenantId, c.patientId, phone, JSON.stringify({ kind: 'lifecycle_reactivation', body })],
    );
    await markLifecycleOutreachSent(tenantId, c.patientId);
    queued += 1;
  }
  return { transitions: transitions.length, candidates: outreachCandidates.length, queued };
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
        { name: 'System', role: 'admin' },
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
