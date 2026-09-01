import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asEnum, sanitizeString } from '@/lib/validate';

const TYPES = ['opening', 'closing', 'other'] as const;

// Same convention as app/api/staff-schedules/route.ts: a tenant-scoped user always acts
// on their own tenant; a super_admin (no tenantId of their own) must say which one via
// ?tenantId=/body.tenantId.
function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

// GET is open to any authenticated tenant member — knowing what checklists exist (to run
// one) is operational info, not something to lock down. Only creating/editing a template
// requires 'checklists:manage'.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get('active') !== 'false';

  const vals: unknown[] = [tenantId];
  let sql = `SELECT * FROM checklist_templates WHERE tenant_id=$1`;
  if (activeOnly) sql += ` AND active=TRUE`;
  sql += ' ORDER BY type, name';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'checklists:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');

  const name = sanitizeString(body.name, 200);
  if (!name) return badRequest('name is required');
  const type = body.type ? asEnum(body.type, TYPES) : 'opening';
  if (body.type && !type) return badRequest(`type must be one of: ${TYPES.join(', ')}`);

  const items = Array.isArray(body.items)
    ? body.items.map((i: unknown) => sanitizeString(i, 300)).filter((i: string) => !!i)
    : [];
  if (!items.length) return badRequest('items must be a non-empty array of strings');

  const [row] = await query(
    `INSERT INTO checklist_templates (tenant_id, name, type, items, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [tenantId, name, type || 'opening', JSON.stringify(items), user.id],
  );

  await appendAudit(user, 'CREATE', `Checklist template: ${name}`, null, `${items.length} items`, user.clinic);

  return created(row);
}
