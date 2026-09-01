import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asEnum, asTime } from '@/lib/validate';

// Same convention as app/api/schema/route.ts and app/api/lead-sources/route.ts: a
// tenant-scoped user always acts on their own tenant; a super_admin (no tenantId of
// their own) must say which one via ?tenantId=/body.tenantId.
function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

// GET is open to any authenticated tenant member (not gated on
// 'staff-schedules:manage') — a shift schedule is operational info everyone on the team
// benefits from seeing ("who's in today"), not something to lock down. Only writing one
// (POST here, DELETE at [id]) requires the permission.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT s.*, u.name AS user_name, u.role
    FROM staff_schedules s JOIN users u ON u.id = s.user_id
    WHERE s.tenant_id=$1`;
  if (userId) {
    vals.push(userId);
    sql += ` AND s.user_id=$${vals.length}`;
  }
  sql += ' ORDER BY u.name, s.weekday, s.start_time';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'staff-schedules:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');
  if (!body.userId) return badRequest('userId is required');
  const weekday = asEnum(String(body.weekday), ['0', '1', '2', '3', '4', '5', '6']);
  if (weekday === null) return badRequest('weekday must be 0-6');
  const startTime = asTime(body.startTime);
  const endTime = asTime(body.endTime);
  if (!startTime || !endTime) return badRequest('startTime/endTime must be HH:MM');
  if (endTime <= startTime) return badRequest('endTime must be after startTime');

  const target = await queryOne(`SELECT id, name FROM users WHERE id=$1 AND tenant_id=$2`, [body.userId, tenantId]);
  if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

  const [row] = await query(
    `INSERT INTO staff_schedules (tenant_id, user_id, weekday, start_time, end_time, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tenantId, body.userId, Number(weekday), startTime, endTime, user.id],
  );

  await appendAudit(
    user,
    'CREATE',
    `Staff schedule: ${target.name}`,
    null,
    `weekday ${weekday} ${startTime}-${endTime}`,
    user.clinic,
  );

  return created({ ...row, user_name: target.name });
}
