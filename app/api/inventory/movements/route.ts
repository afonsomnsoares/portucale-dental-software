import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { applyMovement, type InventoryMovementReason } from '@/lib/inventory';
import { withRoute } from '@/lib/route';
import { asDate, asInt, sanitizeString } from '@/lib/validate';

const REASONS = ['received', 'consumed', 'adjusted', 'wastage', 'expired'] as const;

export const GET = withRoute({ permission: 'inventory:manage', tenant: 'resolved' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId');
  const limitRaw = asInt(searchParams.get('limit'), { min: 1, max: 500 });
  const limit = limitRaw ?? 200;

  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT m.*, i.item AS item_name, u.name AS created_by_name
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.tenant_id=$1`;
  if (itemId) {
    vals.push(Number(itemId));
    sql += ` AND m.item_id=$${vals.length}`;
  }
  vals.push(limit);
  sql += ` ORDER BY m.created_at DESC LIMIT $${vals.length}`;

  const rows = await query(sql, vals);
  return Response.json(rows);
});

export const POST = withRoute(
  { permission: 'inventory:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');

    const itemId = asInt(body.itemId, { min: 1 });
    if (!itemId) return badRequest('itemId is required');
    const reason = (REASONS as readonly string[]).includes(body.reason)
      ? (body.reason as InventoryMovementReason)
      : null;
    if (!reason) return badRequest(`reason must be one of: ${REASONS.join(', ')}`);
    const delta = asInt(body.delta);
    if (delta === null || delta === 0) return badRequest('delta is required and must be a non-zero integer');
    if (reason !== 'received' && delta > 0) return badRequest(`delta must be negative for reason "${reason}"`);
    if (reason === 'received' && delta < 0) return badRequest('delta must be positive for reason "received"');

    const item = await queryOne(`SELECT id, item FROM inventory_items WHERE id=$1`, [itemId]);
    if (!item) return Response.json({ error: 'Inventory item not found' }, { status: 404 });

    const expiryDate = body.expiryDate !== undefined ? asDate(body.expiryDate) : null;
    const { movement, batchId } = await applyMovement(
      tenantId,
      itemId,
      delta,
      reason,
      sanitizeString(body.notes, 1000),
      user.id,
      {
        batchNumber: sanitizeString(body.batchNumber, 100) || undefined,
        expiryDate,
        batchId: body.batchId || undefined,
      },
    );

    await appendAudit(user, 'CREATE', `Inventory movement: ${item.item} (${reason})`, null, String(delta), user.clinic);

    return created({ ...movement, item_name: item.item, batchId });
  },
);
