import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asInt, sanitizeString } from '@/lib/validate';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const { id } = await params;

  const prev = await queryOne(`SELECT * FROM inventory_items WHERE id=$1`, [Number(id)]);
  if (!prev) return notFound('Inventory item not found');

  const body = await request.json();
  const item = body.item !== undefined ? sanitizeString(body.item, 200) || prev.item : prev.item;
  const unit = body.unit !== undefined ? sanitizeString(body.unit, 50) || prev.unit : prev.unit;
  const reorderAt =
    body.reorderAt !== undefined ? (asInt(body.reorderAt, { min: 0 }) ?? prev.reorder_at) : prev.reorder_at;

  const [row] = await query(
    `UPDATE inventory_items SET item=$1, unit=$2, reorder_at=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
    [item, unit, reorderAt, Number(id)],
  );

  await appendAudit(
    user,
    'UPDATE',
    `Inventory item: ${prev.item}`,
    `reorder_at:${prev.reorder_at}`,
    `reorder_at:${row.reorder_at}`,
    user.clinic,
  );

  return Response.json(row);
}
