import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asInt, sanitizeString } from '@/lib/validate';

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => sanitizeString(t, 50).toLowerCase().replace(/\s+/g, '_'))
    .filter((t) => !!t)
    .slice(0, 20);
}

// PUT edits name/chair/tags/active. No DELETE, on purpose — same idiom as
// checklist_templates: retiring a piece of equipment is `active: false`, not removing the
// row, so past scheduling decisions that referenced it stay explainable.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'equipment:manage'))) return forbidden();
  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;

  const prev = await queryOne(
    `SELECT * FROM clinic_equipment WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
    [id, tenantId],
  );
  if (!prev) return notFound('Equipment not found');

  const body = await request.json();
  const name = body.name !== undefined ? sanitizeString(body.name, 200) : prev.name;
  let chair = prev.chair;
  if (body.chair !== undefined) {
    chair = body.chair === null ? null : asInt(body.chair, { min: 1, max: 99 });
    if (body.chair !== null && chair === null) return Response.json({ error: 'chair must be 1-99' }, { status: 400 });
  }
  const tags = body.tags !== undefined ? normalizeTags(body.tags) : prev.tags;
  const active = body.active !== undefined ? !!body.active : prev.active;

  const [row] = await query(
    `UPDATE clinic_equipment SET name=$1, chair=$2, tags=$3, active=$4
     WHERE id=$5 AND ($6::uuid IS NULL OR tenant_id=$6::uuid)
     RETURNING *`,
    [name, chair, tags, active, id, tenantId],
  );

  await appendAudit(
    user,
    'UPDATE',
    `Equipamento: ${prev.name}`,
    `active:${prev.active}`,
    `active:${row.active}`,
    user.clinic,
  );
  return Response.json(row);
}
