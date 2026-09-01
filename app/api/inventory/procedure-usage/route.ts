import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asFee, sanitizeString } from '@/lib/validate';

function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

// Config for item 13's procedure-driven demand forecast (lib/inventory.ts's
// computeProcedureDemandForecast) — "uma consulta do tipo X consome Y unidades do item Z".
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const rows = await query(
    `SELECT piu.*, i.item AS item_name, i.unit
     FROM procedure_item_usage piu JOIN inventory_items i ON i.id = piu.item_id
     WHERE piu.tenant_id=$1
     ORDER BY piu.appointment_type, i.item`,
    [tenantId],
  );
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
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
}
