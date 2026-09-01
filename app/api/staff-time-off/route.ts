import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asDate, asEnum, sanitizeString } from '@/lib/validate';

const TYPES = ['vacation', 'sick', 'other'] as const;
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// Self-service by design: anyone signed in can request time off for themselves (no
// 'staff-time-off:manage' needed for that) — only *seeing everyone's* requests and
// approving/rejecting them requires the permission. Mirrors how patient_tasks' GET/POST
// work for a staff member's own queue vs. the team-wide one. A super_admin has the
// permission but no tenant of their own, so they must pick one via ?tenantId= to see
// anything here — same convention as app/api/lead-sources/route.ts.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const canManage = await hasPermission(user, 'staff-time-off:manage');
  const { searchParams } = new URL(request.url);
  const tenantId = user.tenantId || (canManage ? searchParams.get('tenantId') : null);
  if (!tenantId) return forbidden();

  const status = searchParams.get('status');

  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT t.*, u.name AS user_name
    FROM staff_time_off t JOIN users u ON u.id = t.user_id
    WHERE t.tenant_id=$1`;
  if (!canManage) {
    vals.push(user.id);
    sql += ` AND t.user_id=$${vals.length}`;
  }
  if (status && (STATUSES as readonly string[]).includes(status)) {
    vals.push(status);
    sql += ` AND t.status=$${vals.length}`;
  }
  sql += ' ORDER BY t.start_date DESC';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  const type = body.type ? asEnum(body.type, TYPES) : 'vacation';
  if (body.type && !type) return badRequest(`type must be one of: ${TYPES.join(', ')}`);
  const startDate = asDate(body.startDate);
  const endDate = asDate(body.endDate);
  if (!startDate || !endDate) return badRequest('startDate/endDate must be YYYY-MM-DD');
  if (endDate < startDate) return badRequest('endDate must be on or after startDate');

  // user_id is always the caller — never taken from the body — so this can never be used
  // to file a request on someone else's behalf.
  const [row] = await query(
    `INSERT INTO staff_time_off (tenant_id, user_id, type, start_date, end_date, notes, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [user.tenantId, user.id, type || 'vacation', startDate, endDate, sanitizeString(body.notes, 1000), user.id],
  );

  await appendAudit(user, 'CREATE', `Time off request: ${user.name}`, null, `${startDate} → ${endDate}`, user.clinic);

  return created({ ...row, user_name: user.name });
}
