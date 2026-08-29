// Pure helpers for the no-show risk engine — no DB imports so they are unit-testable.
// This is a deterministic, explainable weighted score (not ML — the project has no
// ML training infra), mirroring the style of lib/recoveryCalc.ts.

export const RISK_WEIGHTS = {
  patientNoShowRate: 0.40, // patient's own historical no-show rate (0-1)
  patientCancelRate: 0.15, // patient's own historical cancellation rate (0-1)
  weekdayBaseRate: 0.15, // tenant-wide no-show/cancel rate for this weekday (0-1)
  hourBaseRate: 0.15, // tenant-wide no-show/cancel rate for this hour bucket (0-1)
  leadTime: 0.10, // longer lead time -> more risk of no-show
  newPatient: 0.05, // first-ever visit carries a flat risk bump
};

export const HOUR_BUCKETS = [
  { key: 'morning', label: 'Manhã (8-12h)', startHour: 8, endHour: 12 },
  { key: 'afternoon', label: 'Tarde (12-17h)', startHour: 12, endHour: 17 },
  { key: 'evening', label: 'Final do dia (17-20h)', startHour: 17, endHour: 20 },
];

export function clamp01(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function hourBucketFor(hour: unknown) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return HOUR_BUCKETS[0].key;
  const found = HOUR_BUCKETS.find((b) => h >= b.startHour && h < b.endHour);
  return found ? found.key : HOUR_BUCKETS[HOUR_BUCKETS.length - 1].key;
}

// Longer lead time = more chances to forget/cancel; ramps 0 -> 1 over 21 days, flat after.
export function leadTimeFactor(leadDays: unknown) {
  const d = Math.max(0, Number(leadDays) || 0);
  return Math.min(1, d / 21);
}

export interface RiskInputs {
  patientNoShowRate?: number;
  patientCancelRate?: number;
  weekdayBaseRate?: number;
  hourBaseRate?: number;
  leadTimeDays?: number;
  isFirstVisit?: boolean;
}

// Returns an integer score 0-100 plus the weighted contribution of each factor,
// so the UI can explain *why* an appointment is flagged (not just a bare number).
export function riskScore(inputs: RiskInputs) {
  const factors = {
    patientNoShowRate: clamp01(inputs.patientNoShowRate),
    patientCancelRate: clamp01(inputs.patientCancelRate),
    weekdayBaseRate: clamp01(inputs.weekdayBaseRate),
    hourBaseRate: clamp01(inputs.hourBaseRate),
    leadTime: leadTimeFactor(inputs.leadTimeDays),
    newPatient: inputs.isFirstVisit ? 1 : 0,
  };

  const contributions = Object.fromEntries(
    (Object.keys(RISK_WEIGHTS) as Array<keyof typeof RISK_WEIGHTS>).map((k) => [k, factors[k] * RISK_WEIGHTS[k]]),
  ) as Record<keyof typeof RISK_WEIGHTS, number>;

  const raw = Object.values(contributions).reduce((a, b) => a + b, 0);
  const score = Math.round(clamp01(raw) * 100);
  return { score, factors, contributions };
}

export interface HistoricalRow {
  appt_date: string | Date;
  start_time: string;
  outcome: 'no-show' | 'cancelled' | 'attended';
}

// Aggregates historical appointments+cancellations into a (weekday, hour-bucket) grid of
// no-show/cancellation rates — the "horários com maior risco" heatmap.
export function aggregateByWeekdayHour(rows: HistoricalRow[]) {
  const cells = new Map<string, { total: number; risky: number }>();
  for (const r of rows) {
    const d = new Date(r.appt_date);
    const weekday = d.getUTCDay();
    const hour = Number(String(r.start_time).slice(0, 2));
    const bucket = hourBucketFor(hour);
    const key = `${weekday}:${bucket}`;
    const cell = cells.get(key) || { total: 0, risky: 0 };
    cell.total += 1;
    if (r.outcome === 'no-show' || r.outcome === 'cancelled') cell.risky += 1;
    cells.set(key, cell);
  }
  return Array.from(cells.entries())
    .map(([key, c]) => {
      const [weekday, bucket] = key.split(':');
      return {
        weekday: Number(weekday),
        bucket,
        total: c.total,
        risky: c.risky,
        rate: c.total > 0 ? c.risky / c.total : 0,
      };
    })
    .sort((a, b) => b.rate - a.rate);
}

export function rateFor(cells: ReturnType<typeof aggregateByWeekdayHour>, weekday: number, bucket: string) {
  const cell = cells.find((c) => c.weekday === weekday && c.bucket === bucket);
  return cell ? cell.rate : 0;
}

function marginalRate<K extends string | number>(rows: HistoricalRow[], keyOf: (r: HistoricalRow) => K) {
  const buckets = new Map<K, { total: number; risky: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = buckets.get(k) || { total: 0, risky: 0 };
    b.total += 1;
    if (r.outcome === 'no-show' || r.outcome === 'cancelled') b.risky += 1;
    buckets.set(k, b);
  }
  return new Map(Array.from(buckets.entries()).map(([k, b]) => [k, b.total > 0 ? b.risky / b.total : 0]));
}

// Marginal (weekday-only, ignoring hour) no-show/cancellation rate — used as one of the
// independent risk factors alongside the hour-bucket rate.
export function ratesByWeekday(rows: HistoricalRow[]) {
  return marginalRate(rows, (r) => new Date(r.appt_date).getUTCDay());
}

// Marginal (hour-bucket-only, ignoring weekday) no-show/cancellation rate.
export function ratesByHourBucket(rows: HistoricalRow[]) {
  return marginalRate(rows, (r) => hourBucketFor(Number(String(r.start_time).slice(0, 2))));
}
