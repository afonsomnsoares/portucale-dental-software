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

// ─── Produtos parados ───────────────────────────────────────────────────────
// O contrário da rutura, e o mais fácil de ignorar: material que está lá, custou
// dinheiro, e não sai. `inventory_movements` (migração 026) tem a informação toda
// desde sempre — o que não existia era a pergunta.
//
// Não é um caso só, são quatro, e tratá-los como um só é o que torna a lista inútil:
//
//   never_moved   nunca teve um único movimento de consumo. Comprou-se e ficou.
//                 Quase sempre um engano de compra ou um procedimento que a clínica
//                 deixou de fazer.
//   stagnant      já foi consumido, mas há muito que não. Mudou o protocolo, mudou a
//                 marca, ou o dentista que o usava saiu.
//   slow          continua a sair, mas tão devagar que o stock atual dá para mais
//                 tempo do que faz sentido ter parado. Não é erro — é excesso.
//   expiring_dead parado E a expirar. Este não é um aviso, é uma perda com data
//                 marcada: ou se usa, ou se transfere para outra clínica do grupo,
//                 ou vai ao lixo com o custo todo.
//
// A ordem acima é a ordem de prioridade, e a classificação devolve a primeira que
// aplicar — 'expiring_dead' primeiro, porque tem prazo.

export type StagnantStatus = 'never_moved' | 'stagnant' | 'slow' | 'expiring_dead' | 'active';

export interface StagnantSignals {
  currentQty: number;
  // Data do último movimento de consumo (reason='consumed'). Null = nunca saiu.
  lastConsumedAt: string | Date | null;
  // Consumo total na janela de observação, para calcular o ritmo.
  consumedInWindow: number;
  windowDays: number;
  // Validade mais próxima entre os lotes com stock, se houver.
  nearestExpiry: string | null;
}

// Quanto tempo sem sair antes de um item deixar de ser "devagar" e passar a "parado".
// 90 dias: um trimestre inteiro sem uma única utilização é longo demais para ser
// sazonalidade em qualquer material dentário de uso corrente.
export const STAGNANT_AFTER_DAYS = 90;
// Cobertura acima da qual o stock é excesso mesmo continuando a sair. 180 dias de
// consumo em armazém é dinheiro parado com uma justificação fraca.
export const SLOW_COVERAGE_DAYS = 180;
// Janela dentro da qual uma validade transforma "parado" em "perda com data marcada".
export const DEAD_STOCK_EXPIRY_DAYS = 90;

function daysBetween(from: string | Date, to: Date) {
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((startOfDay(to).getTime() - startOfDay(d).getTime()) / MS_PER_DAY);
}

export function classifyStagnant(signals: StagnantSignals, today: Date): StagnantStatus {
  // Sem stock não há nada parado — um item esgotado pode estar descontinuado, mas não
  // tem capital imobilizado e não pertence a esta lista.
  if (Number(signals.currentQty) <= 0) return 'active';

  const daysSinceConsumed = signals.lastConsumedAt ? daysBetween(signals.lastConsumedAt, today) : null;
  const idle = daysSinceConsumed === null || daysSinceConsumed >= STAGNANT_AFTER_DAYS;

  if (idle && signals.nearestExpiry) {
    const expiry = batchExpiryStatus(signals.nearestExpiry, today, DEAD_STOCK_EXPIRY_DAYS);
    if (expiry === 'expired' || expiry === 'expiring_soon') return 'expiring_dead';
  }
  if (daysSinceConsumed === null) return 'never_moved';
  if (idle) return 'stagnant';

  const rate = computeConsumptionRate(signals.consumedInWindow, signals.windowDays);
  const coverage = daysUntilStockout(signals.currentQty, rate);
  if (coverage !== null && coverage > SLOW_COVERAGE_DAYS) return 'slow';

  return 'active';
}

export const STAGNANT_LABELS: Record<StagnantStatus, string> = {
  never_moved: 'Nunca consumido',
  stagnant: 'Parado',
  slow: 'Rotação lenta',
  expiring_dead: 'Parado e a expirar',
  active: 'Em uso',
};

// Ordena a lista pelo que interessa decidir primeiro: o que vai expirar (tem prazo),
// depois o que tem mais dinheiro imobilizado. Dentro do mesmo estado, mais valor
// primeiro — e por nome quando o valor empata, para a ordem ser estável entre corridas.
const STAGNANT_PRIORITY: Record<StagnantStatus, number> = {
  expiring_dead: 0,
  never_moved: 1,
  stagnant: 2,
  slow: 3,
  active: 4,
};

export interface StagnantItem {
  itemId: number;
  item: string;
  status: StagnantStatus;
  currentQty: number;
  // Capital imobilizado, quando há custo unitário registado (ver lib/costingCalc.ts).
  // Null quando o item ainda não tem preço — e a UI diz isso em vez de mostrar 0 €,
  // que se leria como "não vale nada".
  tiedUpValue: number | null;
  daysSinceConsumed: number | null;
  nearestExpiry: string | null;
}

export function rankStagnant(items: StagnantItem[]): StagnantItem[] {
  return [...items]
    .filter((i) => i.status !== 'active')
    .sort((a, b) => {
      if (STAGNANT_PRIORITY[a.status] !== STAGNANT_PRIORITY[b.status]) {
        return STAGNANT_PRIORITY[a.status] - STAGNANT_PRIORITY[b.status];
      }
      const va = a.tiedUpValue ?? -1;
      const vb = b.tiedUpValue ?? -1;
      if (va !== vb) return vb - va;
      return a.item < b.item ? -1 : 1;
    });
}

// ─── Reconciliação de encomendas ────────────────────────────────────────────
// Uma encomenda tem três versões de si própria, e só por acaso é que coincidem:
//
//   o que se PEDIU     purchase_order_items
//   o que CHEGOU       os lotes criados na receção (inventory_batches)
//   o que se PAGOU     o total da fatura do fornecedor
//
// Marcar uma encomenda como 'received' — que é tudo o que o sistema fazia — assume
// que as três são a mesma. Na prática o fornecedor manda 8 das 10 caixas, sobe o preço
// unitário sem avisar, ou junta um item que ninguém pediu. Nenhuma dessas coisas dá
// erro em lado nenhum: entram no stock como verdade e a diferença descobre-se meses
// depois, quando alguém compara a conta corrente do fornecedor com o que julgava ter
// comprado. Isto é a comparação, feita no momento da receção.

export type DiscrepancyKind = 'short' | 'over' | 'missing' | 'unexpected' | 'price_variance';

export interface OrderedLine {
  itemId: number;
  item: string;
  quantity: number;
  unitCost: number | null;
}

export interface ReceivedLine {
  itemId: number;
  item: string;
  quantity: number;
  unitCost: number | null;
}

export interface Discrepancy {
  kind: DiscrepancyKind;
  itemId: number;
  item: string;
  orderedQty: number;
  receivedQty: number;
  orderedUnitCost: number | null;
  receivedUnitCost: number | null;
  // Impacto em euros da diferença. Positivo = a clínica pagou/recebeu a mais.
  valueDelta: number | null;
  detail: string;
}

// Tolerância de preço abaixo da qual não vale a pena levantar a questão: um cêntimo de
// arredondamento numa caixa de luvas não é uma variação de preço, é aritmética.
export const PRICE_VARIANCE_TOLERANCE = 0.01;

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function reconcileOrder(ordered: OrderedLine[], received: ReceivedLine[]): Discrepancy[] {
  const receivedByItem = new Map(received.map((r) => [r.itemId, r]));
  const out: Discrepancy[] = [];

  for (const o of ordered) {
    const r = receivedByItem.get(o.itemId);
    const receivedQty = r ? Number(r.quantity) || 0 : 0;
    const orderedQty = Number(o.quantity) || 0;

    if (!r || receivedQty === 0) {
      out.push({
        kind: 'missing',
        itemId: o.itemId,
        item: o.item,
        orderedQty,
        receivedQty: 0,
        orderedUnitCost: o.unitCost,
        receivedUnitCost: null,
        valueDelta: o.unitCost == null ? null : money(-orderedQty * o.unitCost),
        detail: `Pedidas ${orderedQty} unidades, não chegou nenhuma.`,
      });
      continue;
    }

    if (receivedQty !== orderedQty) {
      const diff = receivedQty - orderedQty;
      const unit = r.unitCost ?? o.unitCost;
      out.push({
        kind: diff < 0 ? 'short' : 'over',
        itemId: o.itemId,
        item: o.item,
        orderedQty,
        receivedQty,
        orderedUnitCost: o.unitCost,
        receivedUnitCost: r.unitCost,
        valueDelta: unit == null ? null : money(diff * unit),
        detail:
          diff < 0
            ? `Pedidas ${orderedQty}, chegaram ${receivedQty} — faltam ${-diff}.`
            : `Pedidas ${orderedQty}, chegaram ${receivedQty} — ${diff} a mais.`,
      });
    }

    // O preço verifica-se mesmo quando a quantidade bate certo: é a discrepância que
    // passa despercebida com mais facilidade, porque não há nada visivelmente errado
    // na entrega.
    if (o.unitCost != null && r.unitCost != null && Math.abs(r.unitCost - o.unitCost) > PRICE_VARIANCE_TOLERANCE) {
      const delta = money((r.unitCost - o.unitCost) * receivedQty);
      out.push({
        kind: 'price_variance',
        itemId: o.itemId,
        item: o.item,
        orderedQty,
        receivedQty,
        orderedUnitCost: o.unitCost,
        receivedUnitCost: r.unitCost,
        valueDelta: delta,
        detail: `Encomendado a ${money(o.unitCost)} €/un, faturado a ${money(r.unitCost)} €/un — ${
          delta > 0 ? 'mais' : 'menos'
        } ${money(Math.abs(delta))} € nesta linha.`,
      });
    }
  }

  const orderedIds = new Set(ordered.map((o) => o.itemId));
  for (const r of received) {
    if (orderedIds.has(r.itemId)) continue;
    const qty = Number(r.quantity) || 0;
    out.push({
      kind: 'unexpected',
      itemId: r.itemId,
      item: r.item,
      orderedQty: 0,
      receivedQty: qty,
      orderedUnitCost: null,
      receivedUnitCost: r.unitCost,
      valueDelta: r.unitCost == null ? null : money(qty * r.unitCost),
      detail: `Chegaram ${qty} unidades que não constavam da encomenda.`,
    });
  }

  return out;
}

export interface ReconciliationSummary {
  discrepancies: Discrepancy[];
  orderedValue: number;
  receivedValue: number;
  // Diferença entre o que se esperava pagar e o que a entrega efetivamente vale.
  valueDelta: number;
  // Total declarado pelo fornecedor, quando alguém o registou. A terceira versão da
  // encomenda — a que o dinheiro segue.
  invoicedTotal: number | null;
  // Diferença entre a fatura do fornecedor e o valor do que chegou. É esta a linha que
  // se leva ao fornecedor, e não a das quantidades.
  invoiceDelta: number | null;
  clean: boolean;
}

export function summarizeReconciliation(
  ordered: OrderedLine[],
  received: ReceivedLine[],
  invoicedTotal: number | null = null,
): ReconciliationSummary {
  const discrepancies = reconcileOrder(ordered, received);
  const orderedValue = money(ordered.reduce((s, o) => s + (o.unitCost ?? 0) * (Number(o.quantity) || 0), 0));
  const receivedValue = money(received.reduce((s, r) => s + (r.unitCost ?? 0) * (Number(r.quantity) || 0), 0));
  const invoiceDelta = invoicedTotal == null ? null : money(invoicedTotal - receivedValue);
  return {
    discrepancies,
    orderedValue,
    receivedValue,
    valueDelta: money(receivedValue - orderedValue),
    invoicedTotal: invoicedTotal == null ? null : money(invoicedTotal),
    invoiceDelta,
    // "Limpa" é sem discrepâncias de linha E sem diferença material contra a fatura.
    // Uma encomenda que bate certo item a item mas vem com 40 € de portes por explicar
    // não está reconciliada.
    clean: discrepancies.length === 0 && (invoiceDelta == null || Math.abs(invoiceDelta) <= PRICE_VARIANCE_TOLERANCE),
  };
}
