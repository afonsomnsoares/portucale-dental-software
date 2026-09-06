import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, scopeTenant, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { receivePurchaseOrder } from '@/lib/inventory';
import { hasPermission } from '@/lib/permissions';
import { asDate, asEnum, asInt } from '@/lib/validate';

const TRANSITIONABLE_STATUSES = ['ordered', 'cancelled', 'received'] as const;

// One PUT handles three different things, mutually exclusive per request:
//  - body.status: 'ordered' | 'cancelled' | 'received' — a status transition. 'received'
//    delegates to lib/inventory.ts's receivePurchaseOrder (creates batches + movements).
//  - body.items: replaces the order's line items — only while still 'draft' (an order
//    that's been sent or received is a historical record from here on).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const { id } = await params;
  // super_admin (no tenantId of their own) isn't restricted to one tenant here — same
  // idiom as app/api/lead-sources/[id]/route.ts.
  const tenantId = scopeTenant(user, request);

  const prev = await queryOne(
    `SELECT * FROM purchase_orders WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
    [id, tenantId],
  );
  if (!prev) return notFound('Purchase order not found');

  const body = await request.json();

  if (body.status !== undefined) {
    const status = asEnum(body.status, TRANSITIONABLE_STATUSES);
    if (!status) return badRequest(`status must be one of: ${TRANSITIONABLE_STATUSES.join(', ')}`);

    if (status === 'received') {
      const result = await receivePurchaseOrder(prev.tenant_id, id, user.id);
      if ('error' in result) return Response.json({ error: result.error }, { status: result.status });
      await appendAudit(
        user,
        'UPDATE',
        `Purchase order received`,
        `status:${prev.status}`,
        'status:received',
        user.clinic,
      );
      return Response.json(result.po);
    }

    if (prev.status !== 'draft' && !(prev.status === 'ordered' && status === 'cancelled')) {
      return badRequest(`Cannot move a "${prev.status}" order to "${status}"`);
    }
    const [row] = await query(
      `UPDATE purchase_orders SET status=$1, ordered_at=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [status, status === 'ordered' ? new Date().toISOString() : prev.ordered_at, id],
    );
    await appendAudit(user, 'UPDATE', `Purchase order`, `status:${prev.status}`, `status:${row.status}`, user.clinic);
    return Response.json(row);
  }

  if (Array.isArray(body.items)) {
    if (prev.status !== 'draft') return badRequest('Only a draft order can have its items edited');
    const items = body.items;
    for (const it of items) {
      if (!asInt(it.itemId, { min: 1 }) || !asInt(it.quantity, { min: 1 })) {
        return badRequest('each item needs a valid itemId and a positive integer quantity');
      }
    }
    await query(`DELETE FROM purchase_order_items WHERE purchase_order_id=$1`, [id]);
    for (const it of items) {
      await query(
        `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, item_id, quantity, expiry_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [prev.tenant_id, id, Number(it.itemId), Number(it.quantity), asDate(it.expiryDate)],
      );
    }
    const savedItems = await query(
      `SELECT poi.*, ii.item AS item_name, ii.unit
       FROM purchase_order_items poi JOIN inventory_items ii ON ii.id = poi.item_id
       WHERE poi.purchase_order_id=$1 ORDER BY ii.item`,
      [id],
    );
    await appendAudit(user, 'UPDATE', `Purchase order items`, null, `${items.length} items`, user.clinic);
    return Response.json({ ...prev, items: savedItems });
  }

  return badRequest('Nothing to update — pass status or items');
}
