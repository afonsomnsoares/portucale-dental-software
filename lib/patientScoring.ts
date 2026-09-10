import { query, queryOne, warnSchemaGap } from './db';
import { outreachPriority, type PatientScores, type PatientScoringInputs, scorePatient } from './patientScoringCalc';

// Liga lib/patientScoringCalc.ts a linhas reais, tal como lib/scheduleIntel.ts faz
// para lib/noShowRisk.ts — a fórmula não sabe SQL, isto não decide nada.
//
// Nada aqui é persistido, de propósito. Um score guardado numa coluna é um score que
// se dessincroniza em silêncio no dia em que alguém marca uma consulta por outro
// caminho — a mesma razão pela qual a etapa da jornada (lib/patientJourneyCalc.ts) e o
// estágio de ciclo de vida (lib/lifecycleCalc.ts) são derivados a cada leitura. A
// exceção do projeto, appointments.risk_score, só é persistida porque o job 'riskOutreach'
// precisa de filtrar por ela em SQL antes de decidir a quem manda SMS; aqui não há
// nenhum filtro desses, por isso não há motivo para pagar o preço.

// Quanto tempo depois de um contacto é que uma marcação ainda conta como resposta a
// esse contacto. Sete dias: um doente que liga a marcar duas semanas depois muito
// provavelmente já não está a responder àquele SMS.
const OUTREACH_ATTRIBUTION_DAYS = 7;

export interface ScoredPatient {
  patientId: string;
  name: string;
  phone: string | null;
  scores: PatientScores;
  // churnRisk × bookingPropensity — a ordem por que vale a pena telefonar.
  // Ver outreachPriority em lib/patientScoringCalc.ts.
  priority: number;
}

// As médias da clínica, para a suavização de amostras pequenas em
// lib/patientScoringCalc.ts's smoothedRate. Sem elas cada doente com duas consultas
// produzia taxas de 0% ou 100% e o score inteiro passava a ruído.
async function clinicBaselines(tenantId: string) {
  const row = await queryOne(
    `WITH appt AS (
       SELECT COUNT(*) FILTER (WHERE status='departed')::numeric AS attended,
              COUNT(*) FILTER (WHERE status='no-show')::numeric  AS no_shows,
              COUNT(*)::numeric                                  AS total
       FROM appointments
       WHERE tenant_id=$1 AND appt_date < CURRENT_DATE AND status IN ('departed','no-show')
     ),
     plans AS (
       SELECT COUNT(*) FILTER (WHERE approved)::numeric AS accepted, COUNT(*)::numeric AS total
       FROM treatment_plans WHERE tenant_id=$1
     )
     SELECT CASE WHEN appt.total > 0 THEN appt.attended / appt.total END AS attendance_rate,
            CASE WHEN appt.total > 0 THEN appt.no_shows / appt.total END AS no_show_rate,
            CASE WHEN plans.total > 0 THEN plans.accepted / plans.total END AS acceptance_rate
     FROM appt, plans`,
    [tenantId],
  );
  return {
    // Os defaults são o "não sei" honesto: 0.5 onde não há historial nenhum, e 0.1
    // para faltas porque uma clínica sem historial de faltas não deve começar a
    // assumir que metade dos doentes falta.
    clinicAttendanceRate: row?.attendance_rate != null ? Number(row.attendance_rate) : 0.5,
    clinicNoShowRate: row?.no_show_rate != null ? Number(row.no_show_rate) : 0.1,
    clinicAcceptanceRate: row?.acceptance_rate != null ? Number(row.acceptance_rate) : 0.5,
  };
}

// Uma taxa de conversão de contacto para a clínica inteira: das mensagens enviadas,
// quantas foram seguidas de uma marcação dentro da janela de atribuição.
async function clinicOutreachConversion(tenantId: string) {
  const row = await queryOne(
    `SELECT COUNT(*)::numeric AS sent,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id = n.patient_id
                AND a.created_at BETWEEN n.sent_at AND n.sent_at + ($2::int * INTERVAL '1 day')
            ))::numeric AS converted
     FROM notifications n
     WHERE n.tenant_id=$1 AND n.status='sent' AND n.patient_id IS NOT NULL
       AND n.sent_at >= CURRENT_DATE - INTERVAL '12 months'`,
    [tenantId, OUTREACH_ATTRIBUTION_DAYS],
  );
  const sent = Number(row?.sent || 0);
  return sent > 0 ? Number(row?.converted || 0) / sent : 0.2;
}

// A resposta a um contacto tem duas formas, e as duas contam:
//   • o doente marcou logo a seguir  — mensurável desde sempre;
//   • o doente respondeu à mensagem  — só desde que existe canal de entrada
//     (conversation_messages, migração 049).
// A segunda é consultada à parte e falha em silêncio para uma base ainda sem a
// migração aplicada: warnSchemaGap avisa uma vez e o score continua a ser calculado
// com o sinal que existe, em vez de rebentar a página inteira do doente.
async function inboundRepliesByPatient(tenantId: string): Promise<Map<string, number>> {
  try {
    const rows = await query(
      `SELECT c.patient_id, COUNT(DISTINCT m.id)::int AS replies
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.tenant_id=$1 AND m.direction='inbound' AND c.patient_id IS NOT NULL
         AND m.created_at >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY c.patient_id`,
      [tenantId],
    );
    return new Map(rows.map((r) => [String(r.patient_id), Number(r.replies || 0)]));
  } catch (e) {
    warnSchemaGap('patientScoring.inboundReplies', e);
    return new Map();
  }
}

// Todos os sinais de todos os doentes de uma clínica numa consulta só. É deliberadamente
// uma consulta grande em vez de N pequenas: a página de prioridades quer a clínica
// inteira ordenada, e fazer isto doente a doente seriam milhares de idas ao Postgres.
const SIGNALS_SQL = `
  SELECT p.id,
         p.name,
         p.phone,
         p.balance,
         p.comm_prefs,
         p.last_visit,
         p.created_at,
         COALESCE(p.visit_count, 0)::int AS visit_count,
         (SELECT COUNT(*)::int FROM appointments a
           WHERE a.patient_id=p.id AND a.status='departed') AS attended_count,
         (SELECT COUNT(*)::int FROM appointments a
           WHERE a.patient_id=p.id AND a.status='no-show') AS no_show_count,
         (SELECT COUNT(*)::int FROM appointment_cancellations c
           WHERE c.patient_id=p.id) AS cancel_count,
         EXISTS (SELECT 1 FROM appointments a
                  WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE
                    AND a.status <> 'no-show') AS has_future_appointment,
         (SELECT COUNT(*)::int FROM treatment_plans tp
           WHERE tp.patient_id=p.id) AS plans_presented,
         (SELECT COUNT(*)::int FROM treatment_plans tp
           WHERE tp.patient_id=p.id AND tp.approved) AS plans_accepted,
         EXISTS (SELECT 1 FROM treatment_plans tp
                  WHERE tp.patient_id=p.id AND tp.approved = FALSE) AS has_open_plan,
         -- Mesma definição de "tratamento a meio" que a categoria 'accepted_open' de
         -- lib/recovery.ts: aceite, sem fatura em aberto e sem consulta futura. Uma
         -- definição só, para os dois sítios não poderem discordar sobre quantos são.
         EXISTS (
           SELECT 1 FROM treatments t
           WHERE t.patient_id=p.id AND t.status='accepted'
             AND NOT EXISTS (
               SELECT 1 FROM invoices i
               WHERE i.patient_id=t.patient_id AND i.status IN ('pending','partial') AND i.amount > i.paid
             )
             AND NOT EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.patient_id=t.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
             )
         ) AS has_abandoned_treatment,
         (SELECT MIN(r.next_due) FROM recalls r
           WHERE r.patient_id=p.id AND r.active AND r.next_due <= CURRENT_DATE) AS oldest_recall_due,
         (SELECT COUNT(*)::int FROM notifications n
           WHERE n.patient_id=p.id AND n.status='sent'
             AND n.sent_at >= CURRENT_DATE - INTERVAL '12 months') AS outreach_sent,
         (SELECT COUNT(*)::int FROM notifications n
           WHERE n.patient_id=p.id AND n.status='sent'
             AND n.sent_at >= CURRENT_DATE - INTERVAL '12 months'
             AND EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.patient_id=p.id
                 AND a.created_at BETWEEN n.sent_at AND n.sent_at + ($2::int * INTERVAL '1 day')
             )) AS outreach_converted,
         -- Contactos seguidos sem qualquer marcação a seguir, contados do mais recente
         -- para trás. É o sinal de "silêncio" — três seguidos e "esteve ocupado" deixa
         -- de ser a explicação mais provável.
         (SELECT COUNT(*)::int FROM (
            SELECT n.sent_at, EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id=p.id
                AND a.created_at BETWEEN n.sent_at AND n.sent_at + ($2::int * INTERVAL '1 day')
            ) AS answered
            FROM notifications n
            WHERE n.patient_id=p.id AND n.status='sent'
            ORDER BY n.sent_at DESC
            LIMIT 10
          ) recentes
          WHERE NOT answered
            AND sent_at > COALESCE((
              SELECT MAX(n2.sent_at) FROM notifications n2
              WHERE n2.patient_id=p.id AND n2.status='sent'
                AND EXISTS (
                  SELECT 1 FROM appointments a2
                  WHERE a2.patient_id=p.id
                    AND a2.created_at BETWEEN n2.sent_at AND n2.sent_at + ($2::int * INTERVAL '1 day')
                )
            ), '-infinity'::timestamptz)) AS consecutive_unanswered,
         (p.phone IS NOT NULL AND length(trim(p.phone)) >= 9) AS has_valid_phone,
         (p.dob IS NOT NULL AND p.phone IS NOT NULL AND p.email IS NOT NULL) AS paperwork_complete
  FROM patients p
  WHERE p.tenant_id=$1 AND p.status <> 'anonymized'
`;

function monthsBetween(from: unknown, now: Date): number | undefined {
  if (!from) return undefined;
  const d = new Date(String(from));
  if (Number.isNaN(d.getTime())) return undefined;
  return Math.max(0, (now.getTime() - d.getTime()) / (30.44 * 86_400_000));
}

// `doNotContact` inclui 'sms' — a mesma lista que lib/commPrefs.ts consulta antes de
// qualquer envio automático. Aqui não se decide enviar nada; só se reconhece que uma
// probabilidade de marcação por contacto não faz sentido para quem recusou ser
// contactado, e por isso o score vem a zero com o motivo escrito (ver
// bookingPropensityScore).
function optedOut(commPrefs: unknown): boolean {
  const list = (commPrefs as { doNotContact?: unknown } | null)?.doNotContact;
  return Array.isArray(list) && (list.includes('sms') || list.includes('phone'));
}

function toInputs(
  row: Record<string, unknown>,
  baselines: Awaited<ReturnType<typeof clinicBaselines>>,
  outreachConversion: number,
  inboundReplies: number,
  now: Date,
): PatientScoringInputs {
  const attended = Number(row.attended_count || 0);
  const noShows = Number(row.no_show_count || 0);
  const cancels = Number(row.cancel_count || 0);
  const outreachSent = Number(row.outreach_sent || 0);
  // Uma resposta é uma marcação atribuível OU uma mensagem de volta. O mínimo com
  // outreachSent evita que um doente que escreve cinco vezes seguidas ao mesmo SMS
  // apareça com uma taxa de resposta acima de 100%.
  const responded = Math.min(outreachSent, Number(row.outreach_converted || 0) + inboundReplies);
  // A ausência conta-se da última visita; quem nunca veio conta-se do registo, senão
  // um doente registado ontem e ainda sem consulta apareceria com ausência infinita.
  const monthsSinceLastVisit = monthsBetween(row.last_visit || row.created_at, now);

  return {
    attendedCount: attended,
    scheduledCount: attended + noShows + cancels,
    monthsSinceLastVisit,
    outreachResponded: responded,
    outreachSent,
    plansAccepted: Number(row.plans_accepted || 0),
    plansPresented: Number(row.plans_presented || 0),
    paperworkComplete: Boolean(row.paperwork_complete),
    hasOverdueBalance: Number(row.balance || 0) > 0,
    noShowCount: noShows,
    recallOverdueMonths: monthsBetween(row.oldest_recall_due, now),
    hasAbandonedTreatment: Boolean(row.has_abandoned_treatment),
    consecutiveUnansweredOutreach: Number(row.consecutive_unanswered || 0),
    hasFutureAppointment: Boolean(row.has_future_appointment),
    hasOpenPlan: Boolean(row.has_open_plan),
    recallDue: row.oldest_recall_due != null,
    bookingsAfterOutreach: Number(row.outreach_converted || 0),
    hasValidPhone: Boolean(row.has_valid_phone),
    optedOut: optedOut(row.comm_prefs),
    clinicOutreachConversionRate: outreachConversion,
    ...baselines,
  };
}

/** Os três scores de todos os doentes de uma clínica, já ordenados pela prioridade de contacto. */
export async function computeTenantScores(tenantId: string, limit = 200): Promise<ScoredPatient[]> {
  const [rows, baselines, outreachConversion, inboundReplies] = await Promise.all([
    query(SIGNALS_SQL, [tenantId, OUTREACH_ATTRIBUTION_DAYS]),
    clinicBaselines(tenantId),
    clinicOutreachConversion(tenantId),
    inboundRepliesByPatient(tenantId),
  ]);

  const now = new Date();
  const scored = rows.map((r) => {
    const scores = scorePatient(toInputs(r, baselines, outreachConversion, inboundReplies.get(String(r.id)) || 0, now));
    return {
      patientId: String(r.id),
      name: String(r.name || ''),
      phone: (r.phone as string) || null,
      scores,
      priority: outreachPriority(scores),
    };
  });

  return scored
    .sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.name < b.name ? -1 : 1))
    .slice(0, limit);
}

/** Os três scores de um doente. Mesma fórmula e mesmas médias de clínica que a lista. */
export async function computePatientScore(tenantId: string, patientId: string): Promise<ScoredPatient | null> {
  const [rows, baselines, outreachConversion, inboundReplies] = await Promise.all([
    query(`${SIGNALS_SQL} AND p.id=$3`, [tenantId, OUTREACH_ATTRIBUTION_DAYS, patientId]),
    clinicBaselines(tenantId),
    clinicOutreachConversion(tenantId),
    inboundRepliesByPatient(tenantId),
  ]);
  const row = rows[0];
  if (!row) return null;
  const scores = scorePatient(
    toInputs(row, baselines, outreachConversion, inboundReplies.get(String(row.id)) || 0, new Date()),
  );
  return {
    patientId: String(row.id),
    name: String(row.name || ''),
    phone: (row.phone as string) || null,
    scores,
    priority: outreachPriority(scores),
  };
}
