import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, scopeTenant, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asInt, sanitizeString } from '@/lib/validate';

// Minimal equipment registry — just enough for lib/scheduling.ts's suggestAppointmentSlots
// and lib/waitlist.ts's slot matching to know which chair carries which tagged equipment
// (see requiredEquipmentTags in lib/constants.ts). Deliberately not the full Categoria 14
// (maintenance calendars, alerts, usage history) — that's a separate, later scope.
function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => sanitizeString(t, 50).toLowerCase().replace(/\s+/g, '_'))
    .filter((t) => !!t)
    .slice(0, 20);
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'equipment:manage'))) return forbidden();
  const tenantId = scopeTenant(user, request);
  if (!tenantId) return forbidden();

  const rows = await query(`SELECT * FROM clinic_equipment WHERE tenant_id=$1 ORDER BY chair NULLS LAST, name`, [
    tenantId,
  ]);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'equipment:manage'))) return forbidden();
  const tenantId = scopeTenant(user, request);
  if (!tenantId) return forbidden();

  const body = await request.json();
  const name = sanitizeString(body.name, 200);
  if (!name) return badRequest('name is required');
  const chair = body.chair !== undefined && body.chair !== null ? asInt(body.chair, { min: 1, max: 99 }) : null;
  if (body.chair !== undefined && body.chair !== null && chair === null) return badRequest('chair must be 1-99');
  const tags = normalizeTags(body.tags);

  const [row] = await query(
    `INSERT INTO clinic_equipment (tenant_id, name, chair, tags, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [tenantId, name, chair, tags, user.id],
  );

  await appendAudit(user, 'CREATE', `Equipamento: ${name}`, null, 'active', user.clinic);
  return created(row);
}
