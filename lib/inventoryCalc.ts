// Pure helpers for inventory forecasting/expiry/reorder — no DB imports, unit-testable
// like lib/staffAvailabilityCalc.ts and lib/checklistCalc.ts. lib/inventory.ts wires these
// against real stock/batch/movement rows.

export interface StockBatch {
  id: string;
  quantity: number;
  expiryDate: string | null; // 'YYYY-MM-DD', null = doesn't expire / unknown
}

export interface ConsumptionPlanEntry {
  batchId: string;
  amount: number;
}

export interface ConsumptionPlan {
  entries: ConsumptionPlanEntry[];
  // Amount that couldn't be covered by any batch — e.g. consuming more than the batches on
  // record actually hold. Not an error by itself: an item that was never lot-tracked has no
  // batches at all, so the whole amount comes back as shortfall and the caller just adjusts
  // the tenant-level total without touching any batch.
  shortfall: number;
}

// FEFO (first-expired-first-out): sorts candidate batches by expiry date ascending — a
// batch with no expiry date is treated as "never expires", so it's drained last — and
// greedily consumes `amount` from the earliest-expiring batches first. Never mutates the
// input; the caller applies the plan.
export function planFefoConsumption(batches: StockBatch[], amount: number): ConsumptionPlan {
  if (amount <= 0) return { entries: [], shortfall: 0 };

  const sorted = [...batches]
    .filter((b) => b.quantity > 0)
    .sort((a, b) => {
      if (a.expiryDate === b.expiryDate) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    });

  const entries: ConsumptionPlanEntry[] = [];
  let remaining = amount;
  for (const b of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    entries.push({ batchId: b.id, amount: take });
    remaining -= take;
  }
  return { entries, shortfall: remaining };
}

const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok' | 'no_expiry';

// `warnDays` is how far out "expiring soon" looks — a batch expiring today counts as
// expired (diffDays 0 is NOT < 0)... actually a batch expiring *today* still has today to
// be used, so it's the last day it's "expiring_soon", not yet expired; only a strictly past
// expiry date counts as expired.
export function batchExpiryStatus(expiryDate: string | null, today: Date, warnDays = 30): ExpiryStatus {
  if (!expiryDate) return 'no_expiry';
  const exp = new Date(`${expiryDate}T00:00:00`);
  const diffDays = Math.floor((exp.getTime() - startOfDay(today).getTime()) / MS_PER_DAY);
  if (diffDays < 0) return 'expired';
  if (diffDays <= warnDays) return 'expiring_soon';
  return 'ok';
}

// Units consumed per day over the trailing window — 0 (not negative, not NaN) whenever
// there's nothing to divide, so callers can treat "no rate" and "zero rate" the same way.
export function computeConsumptionRate(totalConsumed: number, windowDays: number): number {
  if (windowDays <= 0 || totalConsumed <= 0) return 0;
  return totalConsumed / windowDays;
}

// null = "at this rate, stock never runs out" (rate is 0 — no consumption history to
// project from) — distinct from 0, which means it's already/about to be gone today.
export function daysUntilStockout(currentQty: number, dailyRate: number): number | null {
  if (dailyRate <= 0) return null;
  return Math.max(0, Math.floor(currentQty / dailyRate));
}

// At risk either because the plain quantity is already at/under the configured reorder
// point (the pre-existing signal this project already had), or — new — because the
// consumption-rate projection says stock runs out before a replacement order could
// plausibly arrive (leadTimeDays).
export function isAtRisk(
  currentQty: number,
  reorderAt: number,
  daysLeft: number | null,
  leadTimeDays: number,
): boolean {
  if (currentQty <= reorderAt) return true;
  if (daysLeft !== null && daysLeft <= leadTimeDays) return true;
  return false;
}

// ─── Item 13's own example: "precisamos de X unidades para os procedimentos previstos
// nos próximos N dias" — a demand forecast driven by the schedule, not by past
// consumption. lib/inventory.ts's computeProcedureDemandForecast wires this against real
// appointment counts and procedure_item_usage rows.

export interface AppointmentTypeCount {
  type: string;
  count: number;
}

export interface ProcedureUsageRow {
  itemId: number;
  appointmentType: string;
  qtyPerProcedure: number;
}

export interface ProcedureDemand {
  itemId: number;
  projectedDemand: number;
}

// Sums qty_per_procedure × how many of that appointment type are booked in the forecast
// window, grouped by item — a type with no mapping configured for it simply contributes
// nothing (the clinic hasn't told the system what it consumes yet), not an error.
export function procedureDemand(counts: AppointmentTypeCount[], usage: ProcedureUsageRow[]): ProcedureDemand[] {
  const countByType = new Map(counts.map((c) => [c.type, c.count]));
  const demandByItem = new Map<number, number>();
  for (const u of usage) {
    const apptCount = countByType.get(u.appointmentType) || 0;
    if (apptCount <= 0) continue;
    const prev = demandByItem.get(u.itemId) || 0;
    demandByItem.set(u.itemId, prev + apptCount * u.qtyPerProcedure);
  }
  return Array.from(demandByItem.entries()).map(([itemId, projectedDemand]) => ({
    itemId,
    projectedDemand: Math.round(projectedDemand * 100) / 100,
  }));
}

// How much to order to cover `targetDays` of projected consumption from today's stock.
// Falls back to a simple reorder-point heuristic (top back up to 2x the reorder point) when
// there's no consumption history yet to project a rate from — same spirit as the "at risk"
// quantity-only signal above, so an item never used through lib/inventory.ts's movements
// (only ever set via the legacy app/api/inventory route) still gets a sane suggestion.
export function suggestReorderQuantity(
  currentQty: number,
  reorderAt: number,
  dailyRate: number,
  targetDays: number,
): number {
  if (dailyRate > 0) {
    const target = Math.ceil(dailyRate * targetDays);
    return Math.max(0, target - currentQty);
  }
  return Math.max(0, reorderAt * 2 - currentQty);
}
