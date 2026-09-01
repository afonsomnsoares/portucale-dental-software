import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asDate, asInt, sanitizeString } from '@/lib/validate';

function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const vals: unknown[] = [tenantId];
  let sql = `SELECT * FROM purchase_orders WHERE tenant_id=$1`;
  if (status) {
    vals.push(status);
    sql += ` AND status=$${vals.length}`;
  }
  sql += ' ORDER BY created_at DESC';
  const orders = await query(sql, vals);

  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await query(
        `SELECT poi.*, ii.item AS item_name, ii.unit
         FROM purchase_order_items poi JOIN inventory_items ii ON ii.id = poi.item_id
         WHERE poi.purchase_order_id = ANY($1::uuid[])
         ORDER BY ii.item`,
        [orderIds],
      )
    : [];
  const itemsByOrder = new Map<string, typeof items>();
  for (const it of items) {
    const list = itemsByOrder.get(it.purchase_order_id) || [];
    list.push(it);
    itemsByOrder.set(it.purchase_order_id, list);
  }

  return Response.json(orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] })));
}

// Manual creation only here — an 'auto' order is only ever created by
// lib/inventory.ts's generateReorderSuggestions (see lib/jobsRunner.ts's 'reorderSuggestions'
// job), never through this endpoint.
export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return badRequest('items must be a non-empty array of {itemId, quantity, expiryDate?}');
  for (const it of items) {
    if (!asInt(it.itemId, { min: 1 }) || !asInt(it.quantity, { min: 1 })) {
      return badRequest('each item needs a valid itemId and a positive integer quantity');
    }
  }

  const [order] = await query(
    `INSERT INTO purchase_orders (tenant_id, status, source, notes, created_by)
     VALUES ($1,'draft','manual',$2,$3)
     RETURNING *`,
    [tenantId, sanitizeString(body.notes, 1000), user.id],
  );

  for (const it of items) {
    await query(
      `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, item_id, quantity, expiry_date)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (purchase_order_id, item_id) DO UPDATE SET quantity=EXCLUDED.quantity, expiry_date=EXCLUDED.expiry_date`,
      [tenantId, order.id, Number(it.itemId), Number(it.quantity), asDate(it.expiryDate)],
    );
  }

  const savedItems = await query(
    `SELECT poi.*, ii.item AS item_name, ii.unit
     FROM purchase_order_items poi JOIN inventory_items ii ON ii.id = poi.item_id
     WHERE poi.purchase_order_id=$1 ORDER BY ii.item`,
    [order.id],
  );

  await appendAudit(user, 'CREATE', `Purchase order (manual, ${items.length} items)`, null, 'draft', user.clinic);

  return created({ ...order, items: savedItems });
}
