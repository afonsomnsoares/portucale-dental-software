import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';

// DELETE only — this row is a configuration knob (how much a procedure type consumes),
// not a historical record like a movement or a checklist run, so removing it outright is
// fine; there's no PUT because the natural "edit the quantity" path is re-POSTing (see
// the ON CONFLICT upsert in ../route.ts).
export const DELETE = withRoute<{ id: string }>(
  { permission: 'inventory:manage', tenant: 'required' },
  async ({ user, params, tenantId }) => {
    const { id } = params;

    const prev = await queryOne(
      `SELECT * FROM procedure_item_usage WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return notFound('Mapping not found');

    await query(`DELETE FROM procedure_item_usage WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
      id,
      tenantId,
    ]);

    await appendAudit(
      user,
      'DELETE',
      `Procedure item usage: ${prev.appointment_type} → item #${prev.item_id}`,
      String(prev.qty_per_procedure),
      null,
      user.clinic,
    );
    return Response.json({ deleted: true });
  },
);
