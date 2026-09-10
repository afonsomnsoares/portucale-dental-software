import { appendAudit } from '@/lib/audit';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asFee, sanitizeString } from '@/lib/validate';

// Config for item 13's procedure-driven demand forecast (lib/inventory.ts's
// computeProcedureDemandForecast) — "uma consulta do tipo X consome Y unidades do item Z".
export const GET = withRoute({ permission: 'inventory:manage', tenant: 'resolved' }, async ({ tenantId }) => {
  const rows = await query(
    `SELECT piu.*, i.item AS item_name, i.unit
     FROM procedure_item_usage piu JOIN inventory_items i ON i.id = piu.item_id
     WHERE piu.tenant_id=$1
     ORDER BY piu.appointment_type, i.item`,
    [tenantId],
  );
  return Response.json(rows);
});

export const POST = withRoute(
  { permission: 'inventory:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');
    const appointmentType = sanitizeString(body.appointmentType, 100);
    if (!appointmentType) return badRequest('appointmentType is required');
    const itemId = Number(body.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) return badRequest('itemId is required');
    const qty = asFee(body.qtyPerProcedure);
    if (qty === null || qty <= 0) return badRequest('qtyPerProcedure must be a positive number');

    const item = await query(`SELECT id FROM inventory_items WHERE id=$1`, [itemId]);
    if (!item.length) return badRequest('Invalid itemId');

    const [row] = await query(
      `INSERT INTO procedure_item_usage (tenant_id, appointment_type, item_id, qty_per_procedure, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, appointment_type, item_id) DO UPDATE SET qty_per_procedure=EXCLUDED.qty_per_procedure
     RETURNING *`,
      [tenantId, appointmentType, itemId, qty, user.id],
    );

    await appendAudit(
      user,
      'CREATE',
      `Procedure item usage: ${appointmentType} → item #${itemId}`,
      null,
      String(qty),
      user.clinic,
    );
    return created(row);
  },
);
