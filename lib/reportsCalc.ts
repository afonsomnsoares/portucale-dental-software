// Pure helpers for the Business Intelligence / Reports engine — no DB imports so they
// are unit-testable, same style as lib/recoveryCalc.ts and lib/lifecycleCalc.ts.

export function pctChange(current: unknown, previous: unknown): number | null {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return (c - p) / p;
}

// The window immediately before [from, to], of the same length in days — used to compute
// period-over-period trends (e.g. "Receita +8.2%").
export function previousPeriodRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const prevTo = new Date(fromDate.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

export function planConversionRate(presentedValue: unknown, acceptedValue: unknown): number {
  const presented = Number(presentedValue) || 0;
  const accepted = Number(acceptedValue) || 0;
  if (presented <= 0) return 0;
  return accepted / presented;
}
