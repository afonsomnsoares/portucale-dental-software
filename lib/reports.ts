import { query, queryOne } from './db';
import { computeRecovery } from './recovery';
import { pctChange, planConversionRate, previousPeriodRange } from './reportsCalc';

export interface PeriodMetrics {
  appointmentsTotal: number;
  noShows: number;
  noShowRate: number;
  treatmentsTotal: number;
  treatmentsCompleted: number;
  conversionRate: number;
  completedValue: number;
  chairMinutes: number;
  chairUtilization: number;
  newPatients: number;
  presentedValue: number;
  acceptedValue: number;
  planConversionRate: number;
}

async function periodMetrics(tenantId: string, from: string, to: string, operatories: number): Promise<PeriodMetrics> {
  const [apptCounts, txCounts, minutesRow, newPatientsRow] = await Promise.all([
    queryOne(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='no-show')::int AS no_show
       FROM appointments WHERE tenant_id=$1 AND appt_date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    ),
    queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='completed')::int AS completed,
              COALESCE(SUM(fee) FILTER (WHERE status='completed'),0)::numeric AS completed_value,
              COALESCE(SUM(fee),0)::numeric AS presented_value,
              COALESCE(SUM(fee) FILTER (WHERE status IN ('accepted','completed')),0)::numeric AS accepted_value
       FROM treatments WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    ),
    queryOne(
      `SELECT COALESCE(SUM(duration),0)::int AS minutes
       FROM appointments WHERE tenant_id=$1 AND appt_date BETWEEN $2::date AND $3::date AND status <> 'no-show'`,
      [tenantId, from, to],
    ),
    queryOne(
      `SELECT COUNT(*)::int AS total FROM patients WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    ),
  ]);

  const dayCount = Math.max(
    1,
    Math.floor((Number(new Date(`${to}T12:00:00Z`)) - Number(new Date(`${from}T12:00:00Z`))) / 86400000) + 1,
  );
  const workMinutes = 8 * 60;
  const chairUtilization = Number(minutesRow?.minutes || 0) / (operatories * workMinutes * dayCount);

  return {
    appointmentsTotal: Number(apptCounts?.total || 0),
    noShows: Number(apptCounts?.no_show || 0),
    noShowRate: Number(apptCounts?.no_show || 0) / Math.max(1, Number(apptCounts?.total || 0)),
    treatmentsTotal: Number(txCounts?.total || 0),
    treatmentsCompleted: Number(txCounts?.completed || 0),
    conversionRate: Number(txCounts?.completed || 0) / Math.max(1, Number(txCounts?.total || 0)),
    completedValue: Number(txCounts?.completed_value || 0),
    chairMinutes: Number(minutesRow?.minutes || 0),
    chairUtilization,
    newPatients: Number(newPatientsRow?.total || 0),
    presentedValue: Number(txCounts?.presented_value || 0),
    acceptedValue: Number(txCounts?.accepted_value || 0),
    planConversionRate: planConversionRate(txCounts?.presented_value, txCounts?.accepted_value),
  };
}

export async function computeClinicSummary(tenantId: string, from: string, to: string) {
  const tenant = await queryOne(`SELECT id, name, operatories FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return null;
  const operatories = Math.max(1, Number(tenant.operatories || 1));
  const prev = previousPeriodRange(from, to);

  const [current, previous, balanceRow, dailyRevenue, recovery] = await Promise.all([
    periodMetrics(tenantId, from, to, operatories),
    periodMetrics(tenantId, prev.from, prev.to, operatories),
    queryOne(`SELECT COALESCE(SUM(balance),0)::numeric AS balance FROM patients WHERE tenant_id=$1`, [tenantId]),
    query(
      `SELECT updated_at::date AS day, COALESCE(SUM(fee),0)::numeric AS revenue
       FROM treatments WHERE tenant_id=$1 AND status='completed' AND updated_at::date BETWEEN $2::date AND $3::date
       GROUP BY day ORDER BY day`,
      [tenantId, from, to],
    ),
    computeRecovery(tenantId),
  ]);

  return {
    tenant: { id: tenant.id, name: tenant.name, operatories },
    range: { from, to },
    metrics: {
      ...current,
      outstandingBalance: Number(balanceRow?.balance || 0),
      recoveryPotential: recovery.total,
    },
    previous: {
      range: prev,
      revenueTrend: pctChange(current.completedValue, previous.completedValue),
      noShowTrend: pctChange(current.noShowRate, previous.noShowRate),
      conversionTrend: pctChange(current.planConversionRate, previous.planConversionRate),
    },
    dailyRevenue,
  };
}

export type ClinicSummary = NonNullable<Awaited<ReturnType<typeof computeClinicSummary>>>;

export async function computeClinicComparison(from: string, to: string) {
  const tenants = await query(`SELECT id FROM tenants WHERE status='active' ORDER BY name`);
  const summaries = (await Promise.all(tenants.map((t) => computeClinicSummary(t.id, from, to)))).filter(
    (s): s is ClinicSummary => !!s,
  );

  const clinics = summaries
    .map((s) => ({
      tenantId: s.tenant.id,
      name: s.tenant.name,
      revenue: s.metrics.completedValue,
      presentedValue: s.metrics.presentedValue,
      acceptedValue: s.metrics.acceptedValue,
      conversionRate: s.metrics.planConversionRate,
      noShowRate: s.metrics.noShowRate,
      chairUtilization: s.metrics.chairUtilization,
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate);

  let gap: { bestTenantId: string; worstTenantId: string; valueDiff: number } | null = null;
  if (clinics.length >= 2) {
    const best = clinics[0];
    const worst = clinics[clinics.length - 1];
    // Value the worst clinic would recover if it converted its own presented plans at the
    // best clinic's rate — the "a diferença representa aproximadamente €X" figure.
    const valueDiff = Math.max(0, (best.conversionRate - worst.conversionRate) * worst.presentedValue);
    gap = { bestTenantId: best.tenantId, worstTenantId: worst.tenantId, valueDiff: Math.round(valueDiff * 100) / 100 };
  }

  return { range: { from, to }, clinics, gap };
}
