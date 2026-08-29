// Pure helpers for the Revenue Recovery engine — no DB imports so they are unit-testable.

export const RECOVERY_DEFAULTS = {
  avgAppointmentFee: 45,
  avgTreatmentFee: 120,
  visitFee: 60,
  slotMinutes: 30,
  workMinutesPerDay: 480,
  inactiveMonths: 6,
  noShowWindowDays: 90,
  cancelledWindowDays: 90,
  emptySlotDays: 14,
};

export function roundEUR(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function avgFee(values: unknown, fallback: number) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return Number(fallback) || 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function recoveryValue(count: unknown, fee: unknown) {
  const opportunities = Math.max(0, Number(count) || 0);
  const valuePerOpportunity = Math.max(0, Number(fee) || 0);
  return roundEUR(opportunities * valuePerOpportunity);
}

export function businessDays(days: number, now = new Date()) {
  let count = 0;
  for (let i = 0; i < Math.max(0, days); i++) {
    const d = new Date(now.getTime() + i * 86400000).getDay();
    if (d >= 1 && d <= 5) count += 1;
  }
  return count;
}

export function freeSlots(
  operatories: number,
  bookedMinutes: number,
  days: number,
  workMinutesPerDay: number = RECOVERY_DEFAULTS.workMinutesPerDay,
  slotMinutes: number = RECOVERY_DEFAULTS.slotMinutes,
  now = new Date(),
) {
  const capacity = Math.max(0, Number(operatories) || 0) * workMinutesPerDay * businessDays(days, now);
  const free = capacity - Math.max(0, Number(bookedMinutes) || 0);
  return free > 0 ? Math.floor(free / Math.max(1, slotMinutes)) : 0;
}

export function monthStart(date = new Date()) {
  return `${date.toISOString().slice(0, 7)}-01`;
}
