import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asInt, sanitizeString } from '@/lib/validate';

export const PUT = withRoute<{ id: string }>(
  { permission: 'inventory:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;

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
  },
);
