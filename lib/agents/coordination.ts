import { canAutoContact } from '../commPrefs';
import { query, queryRead } from '../db';
import { computeJourneyStage, JOURNEY_STAGES } from '../patientJourneyCalc';
import { churnRiskScore } from '../patientScoringCalc';
import {
  type ContactDecision,
  type ContactRequest,
  coordinateContacts,
  type SharedPatientContext,
  summarizeCoordination,
} from './coordinationCalc';

// Liga lib/agents/coordinationCalc.ts (o árbitro, puro e testado) às tabelas.
//
// O contrato com os agentes é o inverso do que era: nenhum agente escreve em
// `notifications`. Todos PEDEM através de requestContacts(), e o que sai é decidido
// aqui — uma vez, com todos os pedidos da passagem à vista. É a única forma de a
// prioridade significar alguma coisa: um árbitro que veja um pedido de cada vez não é
// um árbitro, é uma fila.

export interface QueuedContact {
  patientId: string;
  phone: string;
  payload: Record<string, unknown>;
  appointmentId?: string | null;
}

// O contexto partilhado da clínica inteira, numa consulta. Uma cache por CONSISTÊNCIA e
// não por desempenho: dois agentes a decidir sobre o mesmo doente têm de decidir sobre
// os mesmos factos, senão a arbitragem está a comparar coisas incomparáveis.
export async function buildSharedContext(tenantId: string): Promise<Map<string, SharedPatientContext>> {
  const rows = await queryRead(
    `SELECT p.id, p.name, p.comm_prefs, p.last_visit, p.created_at,
            COALESCE(p.visit_count, 0)::int AS visit_count,
            COALESCE(p.no_show_count, 0)::int AS no_show_count,
            EXISTS (SELECT 1 FROM appointments a
                     WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show') AS has_future,
            EXISTS (SELECT 1 FROM treatments t
                     WHERE t.patient_id=p.id AND t.status IN ('proposed','accepted')) AS has_open_treatment,
            EXISTS (SELECT 1 FROM treatments t WHERE t.patient_id=p.id AND t.status='completed') AS has_completed,
            EXISTS (SELECT 1 FROM treatment_plans tp WHERE tp.patient_id=p.id AND tp.approved=FALSE) AS has_open_plan,
            EXISTS (SELECT 1 FROM treatment_plans tp WHERE tp.patient_id=p.id AND tp.approved=TRUE
                      AND NOT EXISTS (SELECT 1 FROM treatments t2
                                       WHERE t2.patient_id=p.id AND t2.status IN ('accepted','completed'))) AS has_accepted_plan,
            EXISTS (SELECT 1 FROM recalls r
                     WHERE r.patient_id=p.id AND r.active AND r.next_due <= CURRENT_DATE) AS recall_due,
            (SELECT MIN(r.next_due) FROM recalls r
              WHERE r.patient_id=p.id AND r.active AND r.next_due <= CURRENT_DATE) AS oldest_recall_due,
            (SELECT MAX(n.sent_at) FROM notifications n WHERE n.patient_id=p.id AND n.status='sent') AS last_contact_at,
            -- O orçamento de contacto vem do livro de registo (migração 050) e não de
            -- notifications: é o livro que sabe que agente pediu o quê, e é isso que
            -- permite dizer a uma clínica porque é que um SMS não saiu.
            (SELECT COUNT(*)::int FROM agent_contact_ledger l
              WHERE l.patient_id=p.id AND l.decision='granted' AND l.created_at::date = CURRENT_DATE) AS contacts_today,
            (SELECT COUNT(*)::int FROM agent_contact_ledger l
              WHERE l.patient_id=p.id AND l.decision='granted'
                AND l.kind NOT IN ('appointment_reminder','risk_outreach','waitlist_offer')
                AND l.created_at >= NOW() - INTERVAL '7 days') AS promotional_week
     FROM patients p
     WHERE p.tenant_id=$1 AND p.status <> 'anonymized'`,
    [tenantId],
  );

  const now = new Date();
  const stageLabel = new Map(JOURNEY_STAGES.map((s) => [s.key, s.label]));
  const ctx = new Map<string, SharedPatientContext>();

  for (const r of rows) {
    const monthsSince = r.last_visit
      ? (now.getTime() - new Date(r.last_visit).getTime()) / (30.44 * 86_400_000)
      : (now.getTime() - new Date(r.created_at).getTime()) / (30.44 * 86_400_000);
    const churn = churnRiskScore({
      monthsSinceLastVisit: monthsSince,
      recallOverdueMonths: r.oldest_recall_due
        ? (now.getTime() - new Date(r.oldest_recall_due).getTime()) / (30.44 * 86_400_000)
        : 0,
      noShowCount: Number(r.no_show_count) || 0,
      scheduledCount: (Number(r.visit_count) || 0) + (Number(r.no_show_count) || 0),
      hasFutureAppointment: Boolean(r.has_future),
    });
    const stage = computeJourneyStage({
      visitCount: Number(r.visit_count) || 0,
      hasFutureAppointment: Boolean(r.has_future),
      hasOpenTreatment: Boolean(r.has_open_treatment),
      hasCompletedTreatment: Boolean(r.has_completed),
      hasOpenPlan: Boolean(r.has_open_plan),
      hasAcceptedPlanNoTreatment: Boolean(r.has_accepted_plan),
      recallDue: Boolean(r.recall_due),
    });

    ctx.set(String(r.id), {
      patientId: String(r.id),
      name: String(r.name || ''),
      // O engagement e a probabilidade de marcação completos custam uma consulta pesada
      // por doente (ver lib/patientScoring.ts) e o árbitro não os usa — só a coerência
      // usa o risco de abandono. Calcular tudo aqui seria pagar por informação que
      // ninguém nesta passagem lê.
      engagement: 0,
      churnRisk: churn.score,
      bookingPropensity: 0,
      journeyStage: stageLabel.get(stage) || stage,
      hasFutureAppointment: Boolean(r.has_future),
      lastContactAt: r.last_contact_at ? new Date(r.last_contact_at).toISOString() : null,
      contactsToday: Number(r.contacts_today) || 0,
      promotionalThisWeek: Number(r.promotional_week) || 0,
      canContact: canAutoContact(r.comm_prefs, 'sms'),
    });
  }
  return ctx;
}

// O ponto de entrada único dos agentes. Recebe todos os pedidos da passagem, arbitra,
// escreve as mensagens autorizadas em `notifications` e regista TODAS as decisões —
// incluindo as recusadas, que são a parte que torna o árbitro auditável.
export interface GrantedContact {
  patientId: string;
  kind: string;
  notificationId: string | null;
  payload: Record<string, unknown>;
}

export async function requestContacts(
  tenantId: string,
  requests: Array<ContactRequest & { queued: QueuedContact }>,
  contexts?: Map<string, SharedPatientContext>,
) {
  if (!requests.length) {
    return { granted: 0, deferred: 0, rejected: 0, byAgent: {}, yields: [], grantedContacts: [] as GrantedContact[] };
  }

  const ctx = contexts || (await buildSharedContext(tenantId));
  const decisions = coordinateContacts(
    requests.map(({ queued: _q, ...r }) => r),
    ctx,
  );
  const queuedByKey = new Map(requests.map((r) => [`${r.patientId}:${r.kind}:${r.dedupeKey}`, r.queued]));
  // Devolvido a quem chama, e não deixado para ser reconstruído a partir do livro de
  // registo por uma janela de tempo: duas passagens do cron a correrem sobrepostas para
  // a mesma clínica veriam os contactos uma da outra e marcariam efeitos colaterais
  // (cooldowns de recall e de reativação) sobre mensagens que não pediram. Uma lista
  // explícita não tem esse problema, e não depende de relógio nenhum.
  const grantedContacts: GrantedContact[] = [];

  for (const d of decisions) {
    const key = `${d.request.patientId}:${d.request.kind}:${d.request.dedupeKey}`;
    let notificationId: string | null = null;

    if (d.granted) {
      const q = queuedByKey.get(key);
      if (q) {
        const [row] = await query(
          `INSERT INTO notifications
             (tenant_id, patient_id, appointment_id, channel, to_addr, payload, status, next_retry_at)
           VALUES ($1,$2,$3,'sms',$4,$5::jsonb,'queued',NOW())
           RETURNING id`,
          [tenantId, q.patientId, q.appointmentId || null, q.phone, JSON.stringify(q.payload)],
        );
        notificationId = row ? String(row.id) : null;
        grantedContacts.push({
          patientId: q.patientId,
          kind: String(d.request.kind),
          notificationId,
          payload: q.payload,
        });
      }
    }

    await query(
      `INSERT INTO agent_contact_ledger (tenant_id, patient_id, agent_id, kind, decision, reason, notification_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenantId,
        d.request.patientId,
        d.request.agentId,
        d.request.kind,
        d.granted ? 'granted' : d.deferred ? 'deferred' : 'rejected',
        d.granted ? '' : d.reason,
        notificationId,
      ],
    );
  }

  return { ...summarizeCoordination(decisions), grantedContacts };
}

export type { ContactDecision, ContactRequest, SharedPatientContext };
