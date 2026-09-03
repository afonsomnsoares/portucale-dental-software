import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { type ChecklistRunItem, countChecked, isRunComplete, toggleItem } from '@/lib/checklistCalc';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asInt } from '@/lib/validate';

// Toggling a single item is self-service (no 'checklists:manage' needed) — anyone on
// shift can tick items off a shared checklist, same reasoning as
// app/api/checklist-runs/route.ts's POST. Only the item's index/checked state is ever
// taken from the request body; the rest of the item (label) always comes from the stored
// row, so a caller can't rewrite what a checklist item says.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'checklists:run'))) return forbidden();
  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;

  const prev = await queryOne(`SELECT * FROM checklist_runs WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    tenantId,
  ]);
  if (!prev) return notFound('Checklist run not found');

  const body = await request.json();
  const index = asInt(body.index, { min: 0, max: (prev.items as ChecklistRunItem[]).length - 1 });
  if (index === null || body.checked === undefined) return badRequest('index and checked are required');

  const items = toggleItem(prev.items as ChecklistRunItem[], index, !!body.checked, user.id, user.name, new Date());
  const complete = isRunComplete(items);
  const status = complete ? 'completed' : 'in_progress';

  // run_date::text — see the same cast in app/api/checklist-runs/route.ts for why.
  const [row] = await query(
    `UPDATE checklist_runs SET items=$1, status=$2, completed_at=$3
     WHERE id=$4 AND ($5::uuid IS NULL OR tenant_id=$5::uuid)
     RETURNING id, tenant_id, template_id, template_name, type, run_date::text AS run_date, items, status,
               started_by, completed_at, created_at, updated_at`,
    [JSON.stringify(items), status, complete ? new Date().toISOString() : null, id, tenantId],
  );

  await appendAudit(
    user,
    'UPDATE',
    `Checklist run: ${prev.template_name}`,
    `${countChecked(prev.items as ChecklistRunItem[])}/${(prev.items as ChecklistRunItem[]).length}`,
    `${countChecked(items)}/${items.length}`,
    user.clinic,
  );

  return Response.json(row);
}
