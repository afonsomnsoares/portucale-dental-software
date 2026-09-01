import { query, withTransaction } from './db';
import {
  batchExpiryStatus,
  computeConsumptionRate,
  daysUntilStockout,
  isAtRisk,
  planFefoConsumption,
  procedureDemand,
  suggestReorderQuantity,
} from './inventoryCalc';

// Tunable knobs for the forecast — not per-tenant configurable yet (a natural follow-up,
// same as most of this project's other fixed constants e.g. lib/scheduleIntel.ts's
// WORK_MINUTES_PER_DAY).
const CONSUMPTION_WINDOW_DAYS = 30;
const LEAD_TIME_DAYS = 7;
const TARGET_DAYS_OF_STOCK = 30;
const EXPIRY_WARN_DAYS = 30;
// Matches the spec's own example ("...nos próximos 14 dias").
const PROCEDURE_FORECAST_DAYS = 14;

export type InventoryMovementReason = 'received' | 'consumed' | 'adjusted' | 'wastage' | 'expired';

// Every stock change goes through here from now on (the legacy app/api/inventory PUT,
// which just overwrites the quantity directly, is left as-is for the super-admin
// cross-clinic ledger it serves — this is the new, tenant-scoped, history-keeping path).
//
// 'received' optionally opens a new batch (when batchNumber and/or expiryDate is given) —
// that's how validade tracking starts. Every other reason, unless the caller already knows
// which lot it came from (opts.batchId), auto-picks batches FEFO (see
// lib/inventoryCalc.ts's planFefoConsumption) so the batches marked as "about to expire"
// are the first drawn down automatically — an item that was never lot-tracked simply has
// no batches to touch, so nothing there is affected. 'adjusted' never touches batches: a
// correction isn't "this specific lot was used", so it stays a tenant-total-only change.
export async function applyMovement(
  tenantId: string,
  itemId: number,
  delta: number,
  reason: InventoryMovementReason,
  notes: string,
  userId: string,
  opts: { batchNumber?: string; expiryDate?: string | null; batchId?: string } = {},
) {
  return withTransaction(async (client) => {
    let batchId: string | null = null;

    if (reason === 'received') {
      if (opts.batchNumber || opts.expiryDate) {
        const { rows } = await client.query(
          `INSERT INTO inventory_batches (tenant_id, item_id, batch_number, quantity, expiry_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [tenantId, itemId, opts.batchNumber || '', delta, opts.expiryDate || null, userId],
        );
        batchId = rows[0].id;
      }
    } else if (reason !== 'adjusted') {
      const amount = Math.abs(delta);
      const { rows: batchRows } = await client.query(
        `SELECT id, quantity, expiry_date::text AS expiry_date FROM inventory_batches
         WHERE tenant_id=$1 AND item_id=$2 AND quantity>0 ${opts.batchId ? 'AND id=$3' : ''}
         FOR UPDATE`,
        opts.batchId ? [tenantId, itemId, opts.batchId] : [tenantId, itemId],
      );
      const plan = planFefoConsumption(
        batchRows.map((b) => ({ id: b.id, quantity: Number(b.quantity), expiryDate: b.expiry_date })),
        amount,
      );
      for (const e of plan.entries) {
        await client.query(`UPDATE inventory_batches SET quantity = quantity - $1, updated_at=NOW() WHERE id=$2`, [
          e.amount,
          e.batchId,
        ]);
      }
      // Movement still records the whole delta against the tenant total even when part of
      // it is shortfall (nothing left in any batch to draw down) — the total is the source
      // of truth for "how much do we have", batches are only ever a breakdown of it.
      if (opts.batchId && plan.entries.length === 1) batchId = plan.entries[0].batchId;
    }

    await client.query(
      `INSERT INTO inventory_stock (item_id, tenant_id, quantity)
       VALUES ($1,$2,GREATEST(0,$3))
       ON CONFLICT (item_id, tenant_id) DO UPDATE
       SET quantity = GREATEST(0, inventory_stock.quantity + $3), updated_at=NOW()`,
      [itemId, tenantId, delta],
    );

    const { rows: moveRows } = await client.query(
      `INSERT INTO inventory_movements (tenant_id, item_id, batch_id, delta, reason, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [tenantId, itemId, batchId, delta, reason, notes || '', userId],
    );

    return { movement: moveRows[0], batchId };
  });
}

export interface InventoryOverviewRow {
  item: { id: number; item: string; unit: string; reorder_at: number };
  currentQty: number;
  dailyRate: number;
  daysUntilStockout: number | null;
  atRisk: boolean;
  suggestedReorderQty: number;
  batches: Array<{
    id: string;
    batch_number: string;
    quantity: number;
    expiry_date: string | null;
    expiryStatus: 'expired' | 'expiring_soon' | 'ok' | 'no_expiry';
  }>;
}

// One row per master item, combining today's stock (inventory_stock), a trailing-30-day
// consumption rate derived from inventory_movements, and the item's open batches (for
// expiry alerts) — the single read model both app/api/inventory/forecast and
// app/dashboard/admin/inventory's forecast/batches tabs are built from.
export async function computeInventoryOverview(tenantId: string): Promise<InventoryOverviewRow[]> {
  const items = await query(`SELECT * FROM inventory_items ORDER BY item`);
  const stockRows = await query(`SELECT item_id, quantity FROM inventory_stock WHERE tenant_id=$1`, [tenantId]);
  const stockMap = new Map(stockRows.map((r) => [r.item_id, Number(r.quantity)]));

  const consumedRows = await query(
    `SELECT item_id, COALESCE(SUM(-delta),0)::numeric AS consumed
     FROM inventory_movements
     WHERE tenant_id=$1 AND reason IN ('consumed','wastage','expired') AND delta<0
       AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
     GROUP BY item_id`,
    [tenantId, CONSUMPTION_WINDOW_DAYS],
  );
  const consumedMap = new Map(consumedRows.map((r) => [r.item_id, Number(r.consumed)]));

  const batchRows = await query(
    `SELECT id, item_id, batch_number, quantity, expiry_date::text AS expiry_date
     FROM inventory_batches WHERE tenant_id=$1 AND quantity>0
     ORDER BY expiry_date NULLS LAST`,
    [tenantId],
  );
  const batchesByItem = new Map<number, typeof batchRows>();
  for (const b of batchRows) {
    const list = batchesByItem.get(b.item_id) || [];
    list.push(b);
    batchesByItem.set(b.item_id, list);
  }

  const today = new Date();
  return items.map((item) => {
    const currentQty = stockMap.get(item.id) || 0;
    const consumed = consumedMap.get(item.id) || 0;
    const dailyRate = computeConsumptionRate(consumed, CONSUMPTION_WINDOW_DAYS);
    const daysLeft = daysUntilStockout(currentQty, dailyRate);
    const atRisk = isAtRisk(currentQty, Number(item.reorder_at), daysLeft, LEAD_TIME_DAYS);
    const suggestedQty = atRisk
      ? suggestReorderQuantity(currentQty, Number(item.reorder_at), dailyRate, TARGET_DAYS_OF_STOCK)
      : 0;
    const batches = (batchesByItem.get(item.id) || []).map((b) => ({
      id: b.id,
      batch_number: b.batch_number,
      quantity: Number(b.quantity),
      expiry_date: b.expiry_date,
      expiryStatus: batchExpiryStatus(b.expiry_date, today, EXPIRY_WARN_DAYS),
    }));
    return {
      item: { id: item.id, item: item.item, unit: item.unit, reorder_at: Number(item.reorder_at) },
      currentQty,
      dailyRate,
      daysUntilStockout: daysLeft,
      atRisk,
      suggestedReorderQty: suggestedQty,
      batches,
    };
  });
}

export interface ProcedureDemandRow {
  itemId: number;
  item: string;
  unit: string;
  currentQty: number;
  projectedDemand: number;
  shortfall: number;
}

// Item 13's own example: "precisamos de X unidades para os procedimentos previstos nos
// próximos N dias" — driven by what's actually on the calendar (appointments.type ×
// procedure_item_usage), not by past consumption like computeInventoryOverview above.
// The two are complementary, shown side by side in the Previsão tab: one says "you're
// running low based on how things have gone", this one says "here's why, concretely,
// given what's already booked".
export async function computeProcedureDemandForecast(
  tenantId: string,
  days = PROCEDURE_FORECAST_DAYS,
): Promise<ProcedureDemandRow[]> {
  const [counts, usage] = await Promise.all([
    query(
      `SELECT type, COUNT(*)::int AS count
       FROM appointments
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
         AND status NOT IN ('no-show','cancelled')
       GROUP BY type`,
      [tenantId, days],
    ),
    query(`SELECT item_id, appointment_type, qty_per_procedure FROM procedure_item_usage WHERE tenant_id=$1`, [
      tenantId,
    ]),
  ]);
  if (!usage.length) return [];

  const demand = procedureDemand(
    counts.map((c) => ({ type: c.type, count: Number(c.count) })),
    usage.map((u) => ({
      itemId: Number(u.item_id),
      appointmentType: u.appointment_type,
      qtyPerProcedure: Number(u.qty_per_procedure),
    })),
  );
  if (!demand.length) return [];

  const itemIds = demand.map((d) => d.itemId);
  const [items, stockRows] = await Promise.all([
    query(`SELECT id, item, unit FROM inventory_items WHERE id = ANY($1::int[])`, [itemIds]),
    query(`SELECT item_id, quantity FROM inventory_stock WHERE tenant_id=$1 AND item_id = ANY($2::int[])`, [
      tenantId,
      itemIds,
    ]),
  ]);
  const itemById = new Map(items.map((i) => [Number(i.id), i]));
  const stockByItem = new Map(stockRows.map((r) => [Number(r.item_id), Number(r.quantity)]));

  return demand
    .map((d) => {
      const item = itemById.get(d.itemId);
      const currentQty = stockByItem.get(d.itemId) || 0;
      return {
        itemId: d.itemId,
        item: item?.item || `#${d.itemId}`,
        unit: item?.unit || 'un',
        currentQty,
        projectedDemand: d.projectedDemand,
        shortfall: Math.max(0, Math.round((d.projectedDemand - currentQty) * 100) / 100),
      };
    })
    .sort((a, b) => b.shortfall - a.shortfall);
}

// Called by lib/jobsRunner.ts's 'reorderSuggestions' job (see runJob). Merges at-risk items
// into a single open 'auto' draft order per tenant instead of spawning a new one every run
// — re-running the job before anyone has actioned the draft just bumps quantities up if the
// projection got worse, never duplicates the order.
export async function generateReorderSuggestions(tenantId: string) {
  const overview = await computeInventoryOverview(tenantId);
  const candidates = overview.filter((o) => o.atRisk && o.suggestedReorderQty > 0);
  if (!candidates.length) return { suggested: 0, purchaseOrderId: null };

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      `SELECT id FROM purchase_orders WHERE tenant_id=$1 AND status='draft' AND source='auto'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    let poId: string = existing[0]?.id;
    if (!poId) {
      const { rows } = await client.query(
        `INSERT INTO purchase_orders (tenant_id, status, source, notes)
         VALUES ($1,'draft','auto','Sugestão automática — stock em risco de rutura')
         RETURNING id`,
        [tenantId],
      );
      poId = rows[0].id;
    }
    for (const c of candidates) {
      await client.query(
        `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, item_id, quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (purchase_order_id, item_id) DO UPDATE
         SET quantity = GREATEST(purchase_order_items.quantity, EXCLUDED.quantity)`,
        [tenantId, poId, c.item.id, c.suggestedReorderQty],
      );
    }
    return { suggested: candidates.length, purchaseOrderId: poId };
  });
}

// Marking a purchase order received closes the loop: one new batch per line (expiry date
// carried over from the order line, if the admin set one) plus a 'received' movement,
// exactly as if someone had logged each item by hand via applyMovement — receiving through
// a PO is just a convenience that does it for every line at once.
export async function receivePurchaseOrder(tenantId: string, poId: string, userId: string) {
  return withTransaction(async (client) => {
    const { rows: poRows } = await client.query(
      `SELECT * FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [poId, tenantId],
    );
    const po = poRows[0];
    if (!po) return { error: 'Purchase order not found', status: 404 as const };
    if (po.status === 'received') return { error: 'Purchase order already received', status: 400 as const };
    if (po.status === 'cancelled') return { error: 'Purchase order was cancelled', status: 400 as const };

    const { rows: items } = await client.query(`SELECT * FROM purchase_order_items WHERE purchase_order_id=$1`, [poId]);
    for (const it of items) {
      const { rows: batchRows } = await client.query(
        `INSERT INTO inventory_batches (tenant_id, item_id, batch_number, quantity, expiry_date, received_at, created_by)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6)
         RETURNING id`,
        [tenantId, it.item_id, `PO-${String(poId).slice(0, 8)}`, it.quantity, it.expiry_date, userId],
      );
      await client.query(
        `INSERT INTO inventory_stock (item_id, tenant_id, quantity)
         VALUES ($1,$2,GREATEST(0,$3))
         ON CONFLICT (item_id, tenant_id) DO UPDATE
         SET quantity = GREATEST(0, inventory_stock.quantity + $3), updated_at=NOW()`,
        [it.item_id, tenantId, it.quantity],
      );
      await client.query(
        `INSERT INTO inventory_movements (tenant_id, item_id, batch_id, delta, reason, notes, created_by)
         VALUES ($1,$2,$3,$4,'received',$5,$6)`,
        [tenantId, it.item_id, batchRows[0].id, it.quantity, `Receção da encomenda ${poId}`, userId],
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE purchase_orders SET status='received', received_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [poId],
    );
    return { po: updated[0] };
  });
}
