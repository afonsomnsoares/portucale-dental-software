import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, scopeTenant, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asEnum, sanitizeString } from '@/lib/validate';

const TYPES = ['opening', 'closing', 'other'] as const;

// PUT edits name/type/items/active. There is deliberately no DELETE: checklist_runs.id
// references checklist_templates via a FK, and a run is a historical record (it snapshots
// items at creation time — see scripts/migrations/025_clinic_operations.sql) that must
// survive a template being retired. Retiring a template is `active: false` instead, same
// idiom as lead_capture_sources.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'checklists:manage'))) return forbidden();
  const { id } = await params;
  // super_admin (no tenantId of their own) isn't restricted to one tenant here — same
  // idiom as app/api/lead-sources/[id]/route.ts.
  const tenantId = scopeTenant(user, request);

  const prev = await queryOne(
    `SELECT * FROM checklist_templates WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
    [id, tenantId],
  );
  if (!prev) return notFound('Checklist template not found');

  const body = await request.json();
  const name = body.name !== undefined ? sanitizeString(body.name, 200) : prev.name;
  const type = body.type !== undefined ? asEnum(body.type, TYPES) : prev.type;
  if (body.type !== undefined && !type)
    return Response.json({ error: `type must be one of: ${TYPES.join(', ')}` }, { status: 400 });
  const items =
    body.items !== undefined
      ? (Array.isArray(body.items) ? body.items : [])
          .map((i: unknown) => sanitizeString(i, 300))
          .filter((i: string) => !!i)
      : prev.items;
  const active = body.active !== undefined ? !!body.active : prev.active;

  const [row] = await query(
    `UPDATE checklist_templates SET name=$1, type=$2, items=$3, active=$4
     WHERE id=$5 AND ($6::uuid IS NULL OR tenant_id=$6::uuid)
     RETURNING *`,
    [name, type, JSON.stringify(items), active, id, tenantId],
  );

  await appendAudit(
    user,
    'UPDATE',
    `Checklist template: ${prev.name}`,
    `active:${prev.active}`,
    `active:${row.active}`,
    user.clinic,
  );

  return Response.json(row);
}
