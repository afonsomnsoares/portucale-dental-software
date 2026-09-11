import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { buildSharedContext, type QueuedContact, requestContacts } from './agents/coordination';
import type { ContactRequest } from './agents/coordinationCalc';
import { reviewFinance } from './agents/financeAgent';
import { reviewGroup } from './agents/groupAgent';
import { followUpColdLeads, reviewLeadSources, triageOpenLeads } from './agents/leadAgent';
import { reviewManagement } from './agents/managementAgent';
import { reviewPatients } from './agents/patientAgent';
import { generateReorderSuggestionsAI } from './agents/reorderAgent';
import { reviewSchedule } from './agents/schedulingAgent';
import { runAnomalyReview } from './anomaly';
import { appendAudit, appendTimeline } from './audit';
import type { SessionUser } from './auth';
import { runCarePathways } from './carePathway';
import { canAutoContact } from './commPrefs';
import { query, queryOne } from './db';
import { findEquipmentNeedingAttention } from './equipment';
import { sweepStaleConversations } from './inbound';
import { computeLifecycleTransitions, markLifecycleOutreachSent } from './lifecycle';
import { createTask } from './patientTasks';
import { sweepRateLimitCounters } from './rateLimitShared';
import { saveRecoverySnapshot } from './recovery';
import { enforceRetentionPolicies } from './retention';
import { computeUpcomingRisk } from './scheduleIntel';
import { currentOrLastBlock, isNearShiftEnd, shiftLabelForBlock } from './shiftHandoffCalc';
import { sendSms } from './sms';
import type { ScheduleBlock } from './staffAvailabilityCalc';
import { assignOrphanTasks } from './taskRouting';
import { ADMIN_TASK_ROLES } from './taskRoutingCalc';
import { toE164 } from './validate';
import { expireStaleOffers, findCandidates } from './waitlist';

// Shared job-orchestration logic for the background pipeline (reminders, risk scoring,
// proactive outreach, notification sending, cleanup). Both the admin-triggered HTTP
// route (app/api/jobs/run/route.ts, one tenant at a time, on demand) and the unattended
// cron script (scripts/run-jobs.ts, all active tenants, on a timer) call runJob() below
// so the logic itself only lives in one place.
//
// ─── Nenhuma tarefa escreve em notifications ────────────────────────────────
// As funções queue*() abaixo já NÃO inserem mensagens: devolvem PEDIDOS, e no fim da
// passagem o árbitro (lib/agents/coordination.ts) decide quais é que saem, com todos os
// pedidos à vista de uma vez.
//
// A razão é concreta. Cada tarefa deduplicava por TIPO de mensagem — o que impede dois
// lembretes para a mesma consulta e não impede nada entre tarefas diferentes. Um doente
// com uma consulta amanhã, um plano por responder, um recall vencido e seis meses sem
// vir recebia, na mesma passagem, cinco SMS da mesma clínica; dois deles
// contradiziam-se, porque a reativação dizia que não o viam há muito a quem o lembrete
// lembrava de vir amanhã. Cada tarefa estava certa isoladamente.
//
// Um árbitro que veja um pedido de cada vez não é um árbitro, é uma fila — por isso a
// arbitragem acontece uma vez, depois de todas as tarefas de comunicação terem falado.

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
// Item 11 — "handoffs": quão perto do fim do turno é que vale a pena lembrar
// alguém de deixar a passagem. A janela é simétrica (ver isNearShiftEnd), por
// isso 60 minutos cobre tanto quem escreve antes de sair como quem só se lembra
// já depois da hora.
const HANDOFF_REMINDER_WINDOW_MINUTES = 60;

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
  'assignTasks',
  'handoffReminders',
  'send',
  'waitlistExpire',
  'retention',
  'retentionPolicies',
  'summary',
  'recovery',
  'reorderSuggestions',
  'equipmentMaintenance',
  'leadTriage',
  'leadFollowup',
  'leadSourceReview',
  'scheduleReview',
  'patientReview',
  'financeReview',
  'managementReview',
  // Deteção de anomalias — determinística, sem IA (lib/anomaly.ts). Corre a par do
  // managementReview e escreve sob o mesmo agente, separada por tipo de conclusão.
  'anomalyReview',
  // Encadeamento pré e pós-consulta (migração 048). Idempotente por construção — um
  // passo é devido enquanto a prova de que está satisfeito não existir — por isso pode
  // correr em todas as passagens sem duplicar nada.
  'carePathways',
  // Conversas esquecidas no canal de entrada (migração 049). Uma conversa sem resposta
  // é pior do que uma chamada não atendida: o doente já sabe que a mensagem chegou.
  'conversationSweep',
  // Transversal a todas as clínicas — ao contrário de todas as outras, NÃO corre no
  // 'all' de uma clínica (correria N vezes a mesma comparação). Ver runJob abaixo e a
  // chamada única em scripts/run-jobs.ts.
  'groupReview',
] as const;
export type JobName = (typeof JOB_NAMES)[number] | 'all';

function computeNextRetry(attempts: number) {
  const base = 5 * 60 * 1000;
  const delay = base * Math.min(64, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delay).toISOString();
}

// sendSms agora vive em lib/sms.ts (importado acima) — deixou de ser só desta pipeline
// quando app/api/leads/[id]/send-reply/route.ts precisou de a chamar também.

// `tenantId` passou a ser guardado na migração 038: o runJob() sempre soube de que
// clínica era a execução, mas a linha não o registava, por isso a página de Agentes
// não tinha como filtrar. Ver scripts/migrations/038_job_runs_tenant.sql.
// tenantId nullable: o agente Grupo (runGroupReview abaixo) corre sobre todas as
// clínicas e não pertence a nenhuma — a migração 038 deixou a coluna nullable
// exatamente para este caso.
// O que uma tarefa de comunicação devolve agora: o pedido (para o árbitro decidir) e a
// mensagem já montada (para ser inserida só se ele autorizar). Montá-la aqui e não
// depois mantém o texto junto da regra que o justifica.
type PendingContact = ContactRequest & { queued: QueuedContact };

async function logJobRun(tenantId: string | null, jobName: string, status: string, details: Record<string, unknown>) {
  const [row] = await query(
    `INSERT INTO job_runs (tenant_id, job_name, status, details) VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
    [tenantId, jobName, status, JSON.stringify(details || {})],
  );
  return row;
}

async function queueAppointmentReminders(tenantId: string): Promise<{ requests: PendingContact[]; scanned: number }> {
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

  const requests: PendingContact[] = [];
  for (const r of rows) {
    // O consentimento continua a ser verificado aqui e não só no árbitro: é mais barato
    // não montar a mensagem do que montá-la para a deitar fora, e o árbitro verifica-o
    // à mesma — defesa em profundidade, não duplicação por esquecimento.
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
    requests.push({
      agentId: 'scheduling',
      kind: 'appointment_reminder',
      patientId: String(r.patient_id),
      dedupeKey: String(r.appointment_id),
      body,
      queued: {
        patientId: String(r.patient_id),
        phone,
        appointmentId: String(r.appointment_id),
        payload: { kind: 'appointment_reminder', body },
      },
    });
  }
  return { requests, scanned: rows.length };
}

// Proactive side of schedule-intel: for appointments the risk engine flagged as high-risk
// and happening within RISK_OUTREACH_LEAD_DAYS, queue an SMS confirmation ask (distinct
// from the plain reminder) so the receptionist can react before a no-show happens, not
// after. Also attaches a read-only "standby" shortlist from the waitlist for each one —
// "procurar substituto" preventively, before anything is actually freed up: the offer
// itself only ever fires for real once the slot is genuinely cancelled/no-shown (see
// lib/waitlist.ts's notifyWaitlistOfFreedSlot), this is just so reception already knows
// who to call the moment that happens.
async function queueRiskOutreach(tenantId: string): Promise<{ requests: PendingContact[]; scanned: number }> {
  const { scored } = await computeUpcomingRisk(tenantId, RISK_OUTREACH_LEAD_DAYS);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  const candidates = scored.filter((s) => s.score >= RISK_OUTREACH_THRESHOLD);
  if (!candidates.length) return { requests: [], scanned: 0 };

  const apptIds = candidates.map((a) => a.id);
  const [apptDetails, patients] = await Promise.all([
    query(`SELECT id, dentist_id, chair, duration FROM appointments WHERE id = ANY($1::uuid[])`, [apptIds]),
    query(`SELECT id, comm_prefs FROM patients WHERE id = ANY($1::uuid[])`, [candidates.map((a) => a.patient_id)]),
  ]);
  const apptById = new Map(apptDetails.map((d) => [String(d.id), d]));
  const commPrefsByPatient = new Map(patients.map((p) => [String(p.id), p.comm_prefs]));

  const requests: PendingContact[] = [];
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

    requests.push({
      agentId: 'scheduling',
      kind: 'risk_outreach',
      patientId: String(a.patient_id),
      dedupeKey: String(a.id),
      body,
      queued: {
        patientId: String(a.patient_id),
        phone,
        appointmentId: String(a.id),
        payload: { kind: 'risk_outreach', body, standbyCandidates },
      },
    });
  }
  return { requests, scanned: candidates.length };
}

// Proactive side of the Patient Lifecycle engine (lib/lifecycle.ts): finds patients who
// are currently 'inactive', have given marketing-outreach consent, and are past the
// reactivation cooldown, then queues an SMS re-engagement message for each — the
// piece that turns lifecycle staging from a read-only classification into an actual
// re-engagement loop. Booking the resulting appointment is still done by the
// receptionist once the patient replies, same as waitlist offers.
async function queueLifecycleOutreach(
  tenantId: string,
): Promise<{ requests: PendingContact[]; transitions: number; candidates: number }> {
  const { transitions, outreachCandidates } = await computeLifecycleTransitions(tenantId);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);

  const requests: PendingContact[] = [];
  for (const c of outreachCandidates) {
    const phone = canAutoContact(c.commPrefs, 'sms') ? toE164(c.phone) : '';
    if (!phone) continue;
    const body = `Olá ${c.name}, já não o vemos em ${tenant?.name || ''} há algum tempo. Contacte-nos para remarcar a sua consulta.`;
    requests.push({
      agentId: 'patient',
      kind: 'lifecycle_reactivation',
      patientId: String(c.patientId),
      dedupeKey: `lifecycle:${c.patientId}`,
      body,
      queued: {
        patientId: String(c.patientId),
        phone,
        payload: { kind: 'lifecycle_reactivation', body, segment: c.segment },
      },
    });
  }
  // markLifecycleOutreachSent deixou de ser chamado aqui: marcar como enviado antes de
  // o árbitro decidir punia o doente pelo contacto que NÃO recebeu — o cooldown de 30
  // dias arrancava na tentativa em vez de no envio. Passa a ser feito em
  // dispatchContacts, só para os que saíram mesmo.
  return { requests, transitions: transitions.length, candidates: outreachCandidates.length };
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
async function queueRecallOutreach(tenantId: string): Promise<{ requests: PendingContact[]; scanned: number }> {
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

  const requests: PendingContact[] = [];
  for (const r of rows) {
    const phone = canAutoContact(r.comm_prefs, 'sms') ? toE164(r.phone) : '';
    if (!phone) continue;
    const body = `Olá ${r.patient_name}, está na altura de marcar a sua consulta de ${r.recall_type} em ${tenant?.name || ''}. Contacte-nos para agendar.`;
    requests.push({
      agentId: 'patient',
      kind: 'recall_reminder',
      patientId: String(r.patient_id),
      dedupeKey: `recall:${r.id}`,
      body,
      // O id do recall viaja no payload para dispatchContacts poder marcar
      // last_notified_at só nos que saíram, pela mesma razão da reativação.
      queued: {
        patientId: String(r.patient_id),
        phone,
        payload: { kind: 'recall_reminder', body, recallId: r.id },
      },
    });
  }
  return { requests, scanned: rows.length };
}

// Item 6 (Tratamentos e Conversão) / item 5's own example: "consulta há 14 dias + plano
// apresentado + não marcou → follow-up automático". A treatment_plans row that's still
// `approved=false` after PLAN_FOLLOWUP_THRESHOLD_DAYS gets a nudge SMS. Stops itself the
// same way queueRecallOutreach does: once the plan is approved (or cancelled) it simply
// stops matching this WHERE clause on the next run — no separate "cancel the outreach"
// bookkeeping needed. Cooldown is checked against `notifications` directly (by
// payload->>'planId') instead of a new last_notified_at column, since nothing else needs
// one on treatment_plans.
async function queuePlanFollowup(tenantId: string): Promise<{ requests: PendingContact[]; scanned: number }> {
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

  const requests: PendingContact[] = [];
  for (const r of rows) {
    const phone = canAutoContact(r.comm_prefs, 'sms') ? toE164(r.phone) : '';
    if (!phone) continue;
    const body = `Olá ${r.patient_name}, ainda não recebemos a sua decisão sobre o plano de tratamento "${r.title}" em ${tenant?.name || ''}. Contacte-nos com qualquer dúvida ou para avançar.`;
    requests.push({
      agentId: 'patient',
      kind: 'plan_followup',
      patientId: String(r.patient_id),
      dedupeKey: `plan:${r.id}`,
      body,
      queued: {
        patientId: String(r.patient_id),
        phone,
        payload: { kind: 'plan_followup', body, planId: r.id, planValue: Number(r.total_fee || 0) },
      },
    });
  }
  return { requests, scanned: rows.length };
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
      // Item 11 — "distribuição de tarefas". ADMIN_TASK_ROLES em vez do mapa por
      // tipo: o tipo é 'follow_up' por reaproveitamento do CHECK de 018, mas quem
      // responde por um incidente é a direção, não a receção.
      autoAssign: true,
      preferredRoles: ADMIN_TASK_ROLES,
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
      // Ao contrário do escalamento de incidentes, uma checklist de abertura/fecho
      // é trabalho de quem está ao balcão — deixa o mapa por tipo decidir.
      autoAssign: true,
    });
    queued += 1;
  }
  return { queued, scanned: rows.length };
}

// Item 11 — "handoffs": quem está a acabar o turno e ainda não deixou passagem
// recebe uma tarefa a lembrá-lo. Só quem tem turno HOJE entra na conta (blocos em
// staff_schedules), e só dentro da janela à volta da hora de saída — fora disso
// não há nada a passar ainda.
//
// O marcador `handoff:<userId>:<date>:<label>` segue o mesmo idioma de
// escalateIncidents/checklistReminders acima, e inclui o rótulo do turno de
// propósito: um turno partido (manhã + tarde) tem duas passagens legítimas no
// mesmo dia, por isso a chave não pode ser só o dia.
async function handoffReminders(tenantId: string) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA');
  const weekday = now.getDay();

  const rows = await query(
    `SELECT u.id AS user_id, u.name, s.start_time, s.end_time
     FROM users u
     JOIN staff_schedules s ON s.user_id = u.id AND s.weekday = $2
     WHERE u.tenant_id=$1 AND u.active=TRUE AND s.tenant_id=$1`,
    [tenantId, weekday],
  );

  const blocksByUser = new Map<string, { name: string; blocks: ScheduleBlock[] }>();
  for (const r of rows) {
    const entry = blocksByUser.get(r.user_id) || { name: String(r.name), blocks: [] as ScheduleBlock[] };
    entry.blocks.push({
      weekday,
      startTime: String(r.start_time).slice(0, 5),
      endTime: String(r.end_time).slice(0, 5),
    });
    blocksByUser.set(r.user_id, entry);
  }

  let queued = 0;
  for (const [userId, { blocks }] of blocksByUser) {
    if (!isNearShiftEnd(blocks, now, HANDOFF_REMINDER_WINDOW_MINUTES)) continue;
    const label = shiftLabelForBlock(currentOrLastBlock(blocks, now));

    const written = await queryOne(
      `SELECT 1 FROM shift_handoffs
       WHERE tenant_id=$1 AND from_user_id=$2 AND handoff_date=$3::date AND shift_label=$4
       LIMIT 1`,
      [tenantId, userId, dateStr, label],
    );
    if (written) continue;

    const marker = `handoff:${userId}:${dateStr}:${label}`;
    const already = await queryOne(
      `SELECT 1 FROM patient_tasks WHERE tenant_id=$1 AND notes=$2 AND status <> 'cancelled' LIMIT 1`,
      [tenantId, marker],
    );
    if (already) continue;

    // assignedTo explícito (não autoAssign): a passagem é de quem fez o turno,
    // não de quem estiver com menos carga.
    await createTask(tenantId, SYSTEM_ACTOR.id || null, {
      patientId: null,
      type: 'follow_up',
      title: 'Passagem de turno por escrever',
      notes: marker,
      assignedTo: userId,
    });
    queued += 1;
  }
  return { queued, scanned: blocksByUser.size };
}

// Quanto tempo uma linha reservada fica fora do alcance da fila. É o tecto para o
// que uma chamada à Twilio pode demorar mais a margem para o processo escrever o
// resultado; passado isso, presume-se que quem a reservou morreu e a linha volta a
// estar disponível. Curto demais reintroduz o envio duplicado que isto corrige;
// longo demais atrasa a recuperação de um processo que caiu. Cinco minutos é a
// mesma ordem de grandeza do primeiro degrau de computeNextRetry.
const CLAIM_TTL_MINUTES = 5;

async function sendDueNotifications(tenantId: string, limit = 25) {
  // ─── Reservar antes de enviar, não depois ─────────────────────────────────
  // A versão anterior lia com SELECT, chamava a Twilio e só então marcava a linha.
  // Entre as duas coisas havia uma chamada de rede a um terceiro, e nada — nem
  // FOR UPDATE, nem um lock à volta da corrida — impedia um segundo processo de
  // ler as mesmas linhas e enviar as mesmas mensagens. O doente recebia a dobrar.
  //
  // Aqui a leitura e a reserva são a MESMA instrução: quem consegue escrever
  // 'sending' é dono da linha, e o SKIP LOCKED faz com que um segundo processo
  // salte as linhas já reservadas em vez de esperar por elas (esperar só serviria
  // para enviar a seguir o que o primeiro já enviou).
  //
  // `attempts` sobe aqui, na reserva, e não no resultado: uma mensagem entregue à
  // Twilio por um processo que morre antes de gravar a resposta FOI uma tentativa
  // — não sabemos se saiu, e contá-la é o que impede um envio a repetir-se para
  // sempre. É também por isso que os dois caminhos de resultado abaixo já não
  // voltam a incrementar.
  const rows = await query(
    `UPDATE notifications SET
       status = 'sending',
       attempts = attempts + 1,
       next_retry_at = NOW() + make_interval(mins => $3)
     WHERE id IN (
       SELECT id FROM notifications
        WHERE tenant_id = $1
          AND (
            (status IN ('queued','retry') AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
            -- Reserva expirada: quem a fez não chegou a gravar o resultado.
            OR (status = 'sending' AND next_retry_at <= NOW())
          )
        ORDER BY created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [tenantId, limit, CLAIM_TTL_MINUTES],
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
         SET status='sent', provider_id=$1, sent_at=NOW(), last_error=NULL, next_retry_at=NULL
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
      // `n.attempts` vem do RETURNING acima, ou seja já inclui esta tentativa —
      // por isso não se soma 1 outra vez, como a versão anterior fazia.
      const attempts = Number(n.attempts || 0);
      const nextRetry = computeNextRetry(attempts);
      const nextStatus = attempts >= 5 ? 'failed' : 'retry';
      await query(
        `UPDATE notifications
         SET status=$1, last_error=$2, next_retry_at=$3::timestamptz
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
    } catch {
      // intentional — file may already be deleted or missing; DB row is still cleaned up below
    }
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
        await unlink(full).catch(() => {}); // intentional — file may already be gone
        swept += 1;
      }
    }
  } catch {
    // intentional — uploadsDir may not exist on first run; sweep is non-critical
  }

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

// Item 14 — "calendário de manutenção" e "alertas": um equipamento com revisão vencida
// não avisa ninguém sozinho, e o custo de o descobrir tarde é uma cadeira parada com a
// agenda cheia. Isto varre o que está vencido ou nunca foi assistido e deixa a tarefa
// na fila da equipa.
//
// Só o que está mesmo vencido gera tarefa. O 'due_soon' aparece no ecrã de equipamento
// mas não incomoda ninguém — avisar duas semanas antes, todos os dias, é a forma mais
// rápida de ensinar a equipa a ignorar o aviso.
async function equipmentMaintenanceReminders(tenantId: string) {
  const attention = await findEquipmentNeedingAttention(tenantId);
  const needsTask = [...attention.overdue, ...attention.neverServiced];
  let created = 0;

  for (const eq of needsTask) {
    // Marcador estável por equipamento: uma revisão vencida há três semanas não gera
    // uma tarefa por dia. Mesmo padrão do 'next-session:' em appointments/[id]/status.
    const marker = `equipment-service:${eq.id}`;
    const existing = await queryOne(
      `SELECT 1 FROM patient_tasks WHERE tenant_id=$1 AND notes=$2 AND status='pending' LIMIT 1`,
      [tenantId, marker],
    );
    if (existing) continue;

    const porque =
      eq.serviceState === 'never_serviced'
        ? 'nunca foi assistido'
        : `revisão vencida há ${Math.abs(eq.daysUntilService ?? 0)} dias`;
    await createTask(tenantId, null, {
      // Sem patient_id: é trabalho sobre a casa, não sobre um doente. A coluna é
      // nullable exatamente para isto.
      patientId: null,
      type: 'generic',
      title: `Manutenção — ${eq.name}${eq.chair ? ` (cadeira ${eq.chair})` : ''}: ${porque}`,
      notes: marker,
      // Manutenção é trabalho de direção, não de quem está ao balcão.
      preferredRoles: ADMIN_TASK_ROLES,
      autoAssign: true,
    });
    created += 1;
  }

  return {
    created,
    overdue: attention.overdue.length,
    neverServiced: attention.neverServiced.length,
    dueSoon: attention.dueSoon.length,
    outOfService: attention.outOfService.length,
  };
}

// ─── O árbitro ──────────────────────────────────────────────────────────────
// Recebe todos os pedidos que as tarefas de comunicação produziram nesta passagem e
// entrega-os de uma vez a lib/agents/coordination.ts. É aqui que a prioridade passa a
// significar alguma coisa: com todos os pedidos à vista, o lembrete da consulta de
// amanhã ganha ao SMS de reativação, e o de reativação é DIFERIDO — volta a pedir
// amanhã, porque a razão que ele tinha não desapareceu.
//
// Os efeitos colaterais que antes aconteciam ao montar a mensagem acontecem agora só
// para as que saíram mesmo: marcar a reativação como enviada e carimbar
// recalls.last_notified_at. Fazê-lo antes da decisão punia o doente pelo contacto que
// não recebeu — o cooldown arrancava na tentativa em vez de no envio, e um doente que
// perdesse a vez três passagens seguidas ficava trinta dias sem ser contactado por
// mensagens que nunca lhe chegaram.
async function dispatchContacts(tenantId: string, requests: PendingContact[]) {
  if (!requests.length) return { granted: 0, deferred: 0, rejected: 0, byAgent: {}, yields: [] };

  const contexts = await buildSharedContext(tenantId);
  const { grantedContacts, ...summary } = await requestContacts(tenantId, requests, contexts);

  // A lista dos que saíram vem do árbitro, e não de uma releitura do livro de registo
  // por janela de tempo: duas passagens do cron sobrepostas para a mesma clínica veriam
  // os contactos uma da outra e marcariam cooldowns sobre mensagens que não pediram.
  for (const g of grantedContacts) {
    if (g.kind === 'lifecycle_reactivation') {
      await markLifecycleOutreachSent(tenantId, g.patientId);
    }
    if (g.kind === 'recall_reminder' && g.payload.recallId) {
      await query(`UPDATE recalls SET last_notified_at=NOW() WHERE id=$1`, [g.payload.recallId]);
    }
  }

  return summary;
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
    // ─── Tarefas de comunicação: pedem, não enviam ────────────────────────
    // Todas correm primeiro e juntam os pedidos num sítio só; a arbitragem vem a
    // seguir, com tudo à vista. Correr uma tarefa isolada (job !== 'all') continua a
    // funcionar — arbitra-se só com os pedidos dela, que é o comportamento certo:
    // o orçamento diário lido da base já contém o que as outras enviaram.
    const contactRequests: PendingContact[] = [];

    if (job === 'all' || job === 'reminders') {
      const { requests, scanned } = await queueAppointmentReminders(tenantId);
      contactRequests.push(...requests);
      details.appointmentReminders = { requested: requests.length, scanned };
    }
    if (job === 'all' || job === 'risk') {
      const { scored, highRisk } = await computeUpcomingRisk(tenantId);
      details.risk = { scored: scored.length, highRisk: highRisk.length };
    }
    if (job === 'all' || job === 'riskOutreach') {
      const { requests, scanned } = await queueRiskOutreach(tenantId);
      contactRequests.push(...requests);
      details.riskOutreach = { requested: requests.length, scanned };
    }
    if (job === 'all' || job === 'lifecycleOutreach') {
      const { requests, transitions, candidates } = await queueLifecycleOutreach(tenantId);
      contactRequests.push(...requests);
      details.lifecycleOutreach = { requested: requests.length, transitions, candidates };
    }
    if (job === 'all' || job === 'recallOutreach') {
      const { requests, scanned } = await queueRecallOutreach(tenantId);
      contactRequests.push(...requests);
      details.recallOutreach = { requested: requests.length, scanned };
    }
    if (job === 'all' || job === 'planFollowup') {
      const { requests, scanned } = await queuePlanFollowup(tenantId);
      contactRequests.push(...requests);
      details.planFollowup = { requested: requests.length, scanned };
    }
    if (contactRequests.length) {
      details.coordination = await dispatchContacts(tenantId, contactRequests);
    }
    if (job === 'all' || job === 'escalateIncidents') {
      details.escalateIncidents = await escalateIncidents(tenantId);
    }
    if (job === 'all' || job === 'checklistReminders') {
      details.checklistReminders = await checklistReminders(tenantId);
    }
    // Depois de checklistReminders/escalateIncidents, para a varredura já apanhar
    // o que eles acabaram de criar caso não tenha havido ninguém disponível.
    if (job === 'all' || job === 'assignTasks') {
      details.assignTasks = await assignOrphanTasks(tenantId);
    }
    if (job === 'all' || job === 'handoffReminders') {
      details.handoffReminders = await handoffReminders(tenantId);
    }
    if (job === 'all' || job === 'send') {
      details.send = await sendDueNotifications(tenantId, 50);
    }
    if (job === 'all' || job === 'waitlistExpire') {
      details.waitlistExpire = await expireStaleOffers(tenantId);
    }
    if (job === 'all' || job === 'retention') {
      details.retention = await cleanupUploads();
      // Janelas de rate limit já expiradas. O espaço de chaves é escolhido por
      // quem chama (IP + email tentado), por isso sem varredura a tabela cresce
      // sem limite — mesmo raciocínio do sweep em lib/rateLimit.ts.
      details.rateLimitSweep = await sweepRateLimitCounters();
    }
    // Separado de 'retention' (que é limpeza de ficheiros por variável de
    // ambiente): este aplica as políticas que a clínica declarou em
    // data_retention_policies, e é o único que as lê. Ver lib/retention.ts.
    if (job === 'all' || job === 'retentionPolicies') {
      details.retentionPolicies = await enforceRetentionPolicies(tenantId);
    }
    if (job === 'all' || job === 'summary') {
      details.summary = await nightlySummary(tenantId);
    }
    if (job === 'all' || job === 'recovery') {
      details.recoverySnapshot = await saveRecoverySnapshot(tenantId, actor.id || null);
    }
    if (job === 'all' || job === 'reorderSuggestions') {
      // Agente Operações com IA ligada (lib/agents/reorderAgent.ts) — decide sozinho
      // o rascunho de reposição; cai para a regra fixa sem intervenção se a IA não
      // estiver configurada ou a chamada falhar. Ver o cabeçalho desse ficheiro.
      details.reorderSuggestions = await generateReorderSuggestionsAI(tenantId);
    }
    if (job === 'all' || job === 'equipmentMaintenance') {
      details.equipmentMaintenance = await equipmentMaintenanceReminders(tenantId);
    }
    if (job === 'all' || job === 'leadTriage') {
      // Agente Lead (lib/agents/leadAgent.ts) — qualifica e escreve o rascunho de
      // resposta a leads novos. Nunca envia nada: sem ANTHROPIC_API_KEY, ou se a
      // chamada falhar, simplesmente não triagem nada nesta corrida (a próxima
      // apanha-os) — ao contrário do agente Operações, não há regra fixa
      // equivalente para cair de fallback aqui, a decisão É o valor do agente.
      details.leadTriage = await triageOpenLeads(tenantId);
    }
    if (job === 'all' || job === 'leadFollowup') {
      details.leadFollowup = await followUpColdLeads(tenantId);
    }
    if (job === 'all' || job === 'leadSourceReview') {
      details.leadSourceReview = await reviewLeadSources(tenantId);
    }
    if (job === 'all' || job === 'scheduleReview') {
      details.scheduleReview = await reviewSchedule(tenantId);
    }
    if (job === 'all' || job === 'patientReview') {
      details.patientReview = await reviewPatients(tenantId);
    }
    if (job === 'all' || job === 'financeReview') {
      details.financeReview = await reviewFinance(tenantId);
    }
    if (job === 'all' || job === 'managementReview') {
      details.managementReview = await reviewManagement(tenantId);
    }
    if (job === 'all' || job === 'anomalyReview') {
      details.anomalyReview = await runAnomalyReview(tenantId);
    }
    if (job === 'all' || job === 'carePathways') {
      // `steps` fica de fora do que se regista em job_runs: é a lista inteira dos
      // passos devidos, que numa clínica grande são centenas de linhas por passagem, e
      // job_runs é um registo de execuções e não um relatório.
      const { steps: _steps, ...pathways } = await runCarePathways(tenantId);
      details.carePathways = pathways;
    }
    if (job === 'all' || job === 'conversationSweep') {
      details.conversationSweep = await sweepStaleConversations(tenantId);
    }
    // 'groupReview' não aparece aqui de propósito: é transversal às clínicas, não cabe
    // num runJob(tenantId), e tem o seu próprio ponto de entrada (runGroupReview).
    await logJobRun(tenantId, job, 'completed', details);
    await appendAudit(actor, 'UPDATE', `Jobs run: ${job}`, null, 'completed', actor.clinic);
    return { ok: true as const, job, tenantId, details };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logJobRun(tenantId, job, 'failed', { error: message });
    return { ok: false as const, job, tenantId, error: message || 'Job failed' };
  }
}

export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await query(`SELECT id FROM tenants WHERE status='active' ORDER BY name`);
  return rows.map((r) => String(r.id));
}

// O agente Grupo compara clínicas entre si, por isso não pertence a nenhuma e não cabe
// no runJob(tenantId): corre uma vez por passagem do cron, depois do ciclo das clínicas
// (ver scripts/run-jobs.ts). A execução fica em job_runs com tenant_id NULL — que é
// exatamente o caso que a migração 038 previu ao deixar essa coluna nullable.
export async function runGroupReview() {
  try {
    const details = { groupReview: await reviewGroup() };
    await logJobRun(null, 'groupReview', 'completed', details);
    await appendAudit(SYSTEM_ACTOR, 'UPDATE', 'Jobs run: groupReview', null, 'completed', SYSTEM_ACTOR.clinic);
    return { ok: true as const, job: 'groupReview' as const, details };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logJobRun(null, 'groupReview', 'failed', { error: message });
    return { ok: false as const, job: 'groupReview' as const, error: message || 'Job failed' };
  }
}
