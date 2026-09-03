import { query, queryOne } from './db';
import {
  avgFee,
  businessDays,
  freeSlots,
  monthStart,
  RECOVERY_DEFAULTS,
  recoveryValue,
  roundEUR,
} from './recoveryCalc';

const ITEMS_LIMIT = 50;

async function totals(sql: string, params: unknown[]) {
  const row = await queryOne(sql, params);
  return {
    count: Number(row?.count || 0),
    value: roundEUR(row?.value || 0),
  };
}

export async function computeRecovery(tenantId: string) {
  // Preços por clínica (migração 035) — sem este filtro a tarifa média desta
  // clínica sairia da tabela de preços de outra.
  const codes = await query(
    `SELECT DISTINCT ON (code) fee
       FROM treatment_codes
      WHERE fee IS NOT NULL AND (tenant_id IS NULL OR tenant_id = $1::uuid)
      ORDER BY code, (tenant_id IS NOT NULL) DESC`,
    [tenantId],
  ).catch(() => []);
  const fees = codes.map((c) => Number(c.fee));
  const apptFee = avgFee(fees, RECOVERY_DEFAULTS.avgAppointmentFee);
  const visitFee = avgFee(fees, RECOVERY_DEFAULTS.visitFee);

  const tenantRow = await queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]);
  const operatories = Math.max(1, Number(tenantRow?.operatories || 1));

  const inactiveMonths = RECOVERY_DEFAULTS.inactiveMonths;
  const noShowWindowDays = RECOVERY_DEFAULTS.noShowWindowDays;
  const cancelledWindowDays = RECOVERY_DEFAULTS.cancelledWindowDays;
  const slotWindowDays = RECOVERY_DEFAULTS.emptySlotDays;

  const [
    proposedTotals,
    proposedItems,
    acceptedTotals,
    acceptedItems,
    plansPendingTotals,
    plansPendingItems,
    plansNotStartedTotals,
    plansNotStartedItems,
    recallsTotal,
    recallItems,
    inactiveTotal,
    inactiveItems,
    neverBookedTotal,
    neverBookedItems,
    noShowTotal,
    noShowItems,
    cancelledTotal,
    cancelledItems,
    leadsTotal,
    leadItems,
    bookedRow,
    outstandingTotal,
    outstandingItems,
  ] = await Promise.all([
    totals(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(fee),0)::numeric AS value
       FROM treatments t WHERE t.tenant_id=$1 AND t.status='proposed'
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.patient_id=t.patient_id AND i.status IN ('pending','partial') AND i.amount > i.paid
         )`,
      [tenantId],
    ),
    query(
      `SELECT p.id AS patient_id, p.name AS patient_name, p.phone,
              COUNT(*)::int AS items, COALESCE(SUM(t.fee),0)::numeric AS value
       FROM treatments t JOIN patients p ON p.id=t.patient_id
       WHERE t.tenant_id=$1 AND t.status='proposed'
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.patient_id=t.patient_id AND i.status IN ('pending','partial') AND i.amount > i.paid
         )
       GROUP BY p.id, p.name, p.phone
       ORDER BY value DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    // "Abandoned" = accepted (started-or-scheduled) work with nobody chasing it: no
    // future appointment already booked. A patient whose next session IS on the
    // calendar isn't a recovery opportunity — they're already on track — so this is
    // narrower than "every accepted-but-unbilled treatment" (that used to be the whole
    // definition here, which meant a patient who'd already rebooked still showed up on
    // this list with nothing left to do about it).
    totals(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(fee),0)::numeric AS value
       FROM treatments t WHERE t.tenant_id=$1 AND t.status='accepted'
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.patient_id=t.patient_id AND i.status IN ('pending','partial') AND i.amount > i.paid
         )
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id=t.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
         )`,
      [tenantId],
    ),
    query(
      `SELECT p.id AS patient_id, p.name AS patient_name, p.phone,
              COUNT(*)::int AS items, COALESCE(SUM(t.fee),0)::numeric AS value
       FROM treatments t JOIN patients p ON p.id=t.patient_id
       WHERE t.tenant_id=$1 AND t.status='accepted'
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.patient_id=t.patient_id AND i.status IN ('pending','partial') AND i.amount > i.paid
         )
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id=t.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
         )
       GROUP BY p.id, p.name, p.phone
       ORDER BY value DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    // Plans presented but not yet approved — the patient-level counterpart to
    // "proposed_treatments" above, but keyed off treatment_plans (which carries a
    // total_fee and a created_at to measure "how long ago" from, matching what a
    // multi-phase plan actually is) rather than individual treatment line items. The
    // two can overlap for the same patient — treatments and treatment_plans aren't
    // linked by a foreign key in this schema, so a clinic that only ever uses one of
    // the two entities won't see the same work counted twice, but one that uses both
    // for the same case will. Documented, not silently hidden.
    totals(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_fee),0)::numeric AS value
       FROM treatment_plans WHERE tenant_id=$1 AND approved=FALSE`,
      [tenantId],
    ),
    query(
      `SELECT tp.id, tp.patient_id, p.name AS patient_name, p.phone, tp.title, tp.total_fee AS value,
              EXTRACT(day FROM NOW() - tp.created_at)::int AS days_since
       FROM treatment_plans tp JOIN patients p ON p.id=tp.patient_id
       WHERE tp.tenant_id=$1 AND tp.approved=FALSE
       ORDER BY tp.created_at ASC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    // Plans the patient already said yes to, but where no treatment under them has
    // actually started (no treatments row for the patient past 'proposed') — the "€Z
    // ainda não iniciados" bucket. Same patient-level join caveat as above.
    totals(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_fee),0)::numeric AS value
       FROM treatment_plans tp
       WHERE tp.tenant_id=$1 AND tp.approved=TRUE
         AND NOT EXISTS (
           SELECT 1 FROM treatments t WHERE t.patient_id=tp.patient_id AND t.status IN ('accepted','completed')
         )`,
      [tenantId],
    ),
    query(
      `SELECT tp.id, tp.patient_id, p.name AS patient_name, p.phone, tp.title, tp.total_fee AS value,
              EXTRACT(day FROM NOW() - tp.approved_at)::int AS days_since
       FROM treatment_plans tp JOIN patients p ON p.id=tp.patient_id
       WHERE tp.tenant_id=$1 AND tp.approved=TRUE
         AND NOT EXISTS (
           SELECT 1 FROM treatments t WHERE t.patient_id=tp.patient_id AND t.status IN ('accepted','completed')
         )
       ORDER BY tp.approved_at ASC NULLS LAST
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    totals(
      `SELECT COUNT(*)::int AS count
       FROM recalls r WHERE r.tenant_id=$1 AND r.active=TRUE AND r.next_due <= CURRENT_DATE`,
      [tenantId],
    ),
    query(
      `SELECT r.id, r.patient_id, p.name AS patient_name, p.phone, r.recall_type, r.next_due
       FROM recalls r JOIN patients p ON p.id=r.patient_id
       WHERE r.tenant_id=$1 AND r.active=TRUE AND r.next_due <= CURRENT_DATE
       ORDER BY r.next_due
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    totals(
      `SELECT COUNT(*)::int AS count FROM patients
       WHERE tenant_id=$1 AND status <> 'anonymized' AND COALESCE(visit_count,0) > 0
         AND (last_visit IS NULL OR last_visit < CURRENT_DATE - ($2::int * INTERVAL '1 month'))`,
      [tenantId, inactiveMonths],
    ),
    query(
      `SELECT id AS patient_id, name AS patient_name, phone, last_visit
       FROM patients
       WHERE tenant_id=$1 AND status <> 'anonymized' AND COALESCE(visit_count,0) > 0
         AND (last_visit IS NULL OR last_visit < CURRENT_DATE - ($2::int * INTERVAL '1 month'))
       ORDER BY last_visit NULLS FIRST
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId, inactiveMonths],
    ),
    totals(
      `SELECT COUNT(*)::int AS count FROM patients p
       WHERE p.tenant_id=$1 AND p.status <> 'anonymized' AND COALESCE(p.visit_count,0)=0
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE AND a.status NOT IN ('no-show','cancelled')
         )`,
      [tenantId],
    ),
    query(
      `SELECT p.id AS patient_id, p.name AS patient_name, p.phone, p.created_at
       FROM patients p
       WHERE p.tenant_id=$1 AND p.status <> 'anonymized' AND COALESCE(p.visit_count,0)=0
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE AND a.status NOT IN ('no-show','cancelled')
         )
       ORDER BY p.created_at DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    totals(
      `SELECT COUNT(*)::int AS count FROM appointments
       WHERE tenant_id=$1 AND status='no-show'
         AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`,
      [tenantId, noShowWindowDays],
    ),
    query(
      `SELECT a.id, a.patient_id, a.patient_name, p.phone, a.appt_date, a.type
       FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
       WHERE a.tenant_id=$1 AND a.status='no-show'
         AND a.appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
       ORDER BY a.appt_date DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId, noShowWindowDays],
    ),
    totals(
      `SELECT COUNT(*)::int AS count
       FROM appointment_cancellations
       WHERE tenant_id=$1
         AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`,
      [tenantId, cancelledWindowDays],
    ),
    query(
      `SELECT c.id, c.patient_id, c.patient_name, p.phone, c.appt_date, c.type
       FROM appointment_cancellations c LEFT JOIN patients p ON p.id=c.patient_id
       WHERE c.tenant_id=$1
         AND c.appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
       ORDER BY c.appt_date DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId, cancelledWindowDays],
    ),
    totals(
      `SELECT COUNT(*)::int AS count
       FROM leads l
       WHERE l.tenant_id=$1 AND l.status='open'`,
      [tenantId],
    ),
    query(
      `SELECT l.id, NULL::uuid AS patient_id, l.name AS patient_name, l.phone, l.email,
              l.source, l.created_at
       FROM leads l
       WHERE l.tenant_id=$1 AND l.status='open'
       ORDER BY l.created_at DESC
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
    queryOne(
      `SELECT COALESCE(SUM(duration),0)::int AS minutes
       FROM appointments
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE
         AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
         AND status NOT IN ('no-show','cancelled')`,
      [tenantId, slotWindowDays],
    ),
    totals(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount-paid),0)::numeric AS value
       FROM invoices WHERE tenant_id=$1 AND status IN ('pending','partial') AND amount > paid`,
      [tenantId],
    ),
    query(
      `SELECT id, patient_id, patient_name, due_date, (amount-paid)::numeric AS value
       FROM invoices WHERE tenant_id=$1 AND status IN ('pending','partial') AND amount > paid
       ORDER BY due_date ASC NULLS LAST
       LIMIT ${ITEMS_LIMIT}`,
      [tenantId],
    ),
  ]);

  const days = businessDays(slotWindowDays);
  const slots = freeSlots(operatories, Number(bookedRow?.minutes || 0), slotWindowDays);

  const categories = [
    {
      key: 'proposed_treatments',
      label: 'Orçamentos não aceites',
      description: 'Tratamentos propostos que o doente ainda não aceitou.',
      action: 'Ligar ao doente para rever o orçamento',
      count: proposedTotals.count,
      estimatedValue: proposedTotals.value,
      items: proposedItems.map((i) => ({
        ...i,
        value: roundEUR(i.value),
        detail: `${Number(i.items)} tratamento(s) proposto(s)`,
      })),
    },
    {
      key: 'accepted_open',
      label: 'Tratamentos Abandonados',
      description: 'Tratamentos já aceites, sem próxima consulta marcada — ninguém está a dar seguimento.',
      action: 'Agendar a continuação do tratamento',
      count: acceptedTotals.count,
      estimatedValue: acceptedTotals.value,
      items: acceptedItems.map((i) => ({
        ...i,
        value: roundEUR(i.value),
        detail: `${Number(i.items)} tratamento(s) em aberto, sem próxima sessão`,
      })),
    },
    {
      key: 'plans_pending_decision',
      label: 'Planos Apresentados',
      description: 'Planos de tratamento apresentados que o doente ainda não aceitou nem recusou.',
      action: 'Fazer follow-up ao plano apresentado',
      count: plansPendingTotals.count,
      estimatedValue: plansPendingTotals.value,
      items: plansPendingItems.map((i) => ({
        ...i,
        value: roundEUR(i.value),
        daysSince: Number(i.days_since),
        detail: `${i.title} · apresentado há ${Number(i.days_since)} dia(s)`,
      })),
    },
    {
      key: 'plans_not_started',
      label: 'Planos por Iniciar',
      description: 'Planos já aceites pelo doente, mas cujo tratamento ainda não começou.',
      action: 'Agendar a primeira sessão do plano',
      count: plansNotStartedTotals.count,
      estimatedValue: plansNotStartedTotals.value,
      items: plansNotStartedItems.map((i) => ({
        ...i,
        value: roundEUR(i.value),
        daysSince: i.days_since != null ? Number(i.days_since) : null,
        detail: `${i.title} · aceite ${i.days_since != null ? `há ${Number(i.days_since)} dia(s)` : ''}`,
      })),
    },
    {
      key: 'recalls_overdue',
      label: 'Recalls atrasados',
      description: 'Doentes com recall ativo cuja data já passou.',
      action: 'Ligar para agendar a consulta de revisão',
      count: recallsTotal.count,
      estimatedValue: recoveryValue(recallsTotal.count, visitFee),
      items: recallItems.map((i) => ({
        ...i,
        value: roundEUR(visitFee),
        detail: `Recall ${i.recall_type} · vencido a ${String(i.next_due).slice(0, 10)}`,
      })),
    },
    {
      key: 'inactive_patients',
      label: `Pacientes inativos (> ${inactiveMonths} meses)`,
      description: 'Já foram doentes da clínica mas não voltam há demasiado tempo.',
      action: 'Campanha de reativação',
      count: inactiveTotal.count,
      estimatedValue: recoveryValue(inactiveTotal.count, visitFee),
      items: inactiveItems.map((i) => ({
        ...i,
        value: roundEUR(visitFee),
        detail: i.last_visit ? `Última visita: ${String(i.last_visit).slice(0, 10)}` : 'Sem visita registada',
      })),
    },
    {
      key: 'never_booked',
      label: 'Registados sem marcação',
      description: 'Registados na clínica que nunca compareceram nem têm consulta futura.',
      action: 'Ligar para marcar a primeira consulta',
      count: neverBookedTotal.count,
      estimatedValue: recoveryValue(neverBookedTotal.count, visitFee),
      items: neverBookedItems.map((i) => ({
        ...i,
        value: roundEUR(visitFee),
        detail: `Registado a ${String(i.created_at).slice(0, 10)}`,
      })),
    },
    {
      key: 'no_shows_90d',
      label: 'No-shows (90 dias)',
      description: 'Consultas perdidas nos últimos 90 dias que vale a pena remarcar.',
      action: 'Remarcar a consulta perdida',
      count: noShowTotal.count,
      estimatedValue: recoveryValue(noShowTotal.count, apptFee),
      items: noShowItems.map((i) => ({
        ...i,
        value: roundEUR(apptFee),
        detail: `${i.type || 'Consulta'} · falta a ${String(i.appt_date).slice(0, 10)}`,
      })),
    },
    {
      key: 'cancelled_90d',
      label: 'Consultas canceladas (90 dias)',
      description: 'Consultas canceladas recentemente que podem ser remarcadas.',
      action: 'Contactar o doente para remarcar a consulta',
      count: cancelledTotal.count,
      estimatedValue: recoveryValue(cancelledTotal.count, apptFee),
      items: cancelledItems.map((i) => ({
        ...i,
        value: roundEUR(apptFee),
        detail: `${i.type || 'Consulta'} · cancelada a ${String(i.appt_date).slice(0, 10)}`,
      })),
    },
    {
      key: 'unbooked_leads',
      label: 'Leads sem marcação',
      description: 'Potenciais pacientes que contactaram a clínica mas ainda não marcaram.',
      action: 'Contactar o lead para marcar a primeira consulta',
      count: leadsTotal.count,
      estimatedValue: roundEUR(leadsTotal.count * visitFee),
      items: leadItems.map((i) => ({
        ...i,
        value: roundEUR(visitFee),
        detail: `${i.source ? `${i.source} · ` : ''}Lead registado a ${String(i.created_at).slice(0, 10)}`,
      })),
    },
    {
      key: 'empty_slots',
      label: `Slots vazios (${slotWindowDays} dias)`,
      description: `Capacidade livre nos próximos dias úteis (${days} dias úteis · ${operatories} cadeira(s)).`,
      action: 'Preencher agenda com lista de espera',
      count: slots,
      estimatedValue: recoveryValue(slots, apptFee),
      items: [],
    },
    {
      key: 'outstanding_balance',
      label: 'Saldos por cobrar',
      description: 'Faturas pendentes ou parcialmente pagas.',
      action: 'Contactar o doente para regularizar o pagamento',
      count: outstandingTotal.count,
      estimatedValue: outstandingTotal.value,
      items: outstandingItems.map((i) => ({
        ...i,
        value: roundEUR(i.value),
        detail: i.due_date ? `Venceu a ${String(i.due_date).slice(0, 10)}` : 'Sem data de vencimento',
      })),
    },
  ];

  const total = roundEUR(categories.reduce((acc, c) => acc + c.estimatedValue, 0));

  return { total, categories };
}

export async function saveRecoverySnapshot(tenantId: string, userId?: string | null) {
  const data = await computeRecovery(tenantId);
  const month = monthStart();
  await query(
    `INSERT INTO recovery_snapshots (tenant_id, snapshot_month, total_estimated, categories, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (tenant_id, snapshot_month)
     DO UPDATE SET total_estimated=EXCLUDED.total_estimated,
                   categories=EXCLUDED.categories,
                   created_at=NOW()`,
    [
      tenantId,
      month,
      data.total,
      JSON.stringify(
        Object.fromEntries(data.categories.map((c) => [c.key, { count: c.count, estimatedValue: c.estimatedValue }])),
      ),
      userId || null,
    ],
  );
  return { month, total: data.total };
}
