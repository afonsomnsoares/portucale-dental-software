import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, scopeTenant, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';

// DELETE only — this row is a configuration knob (how much a procedure type consumes),
// not a historical record like a movement or a checklist run, so removing it outright is
// fine; there's no PUT because the natural "edit the quantity" path is re-POSTing (see
// the ON CONFLICT upsert in ../route.ts).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const { id } = await params;
  const tenantId = scopeTenant(user, request);

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
}
