import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireRoles, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  if (!(await hasPermission(user, 'audit:read'))) return forbidden();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  // audit_log has no tenant_id, only a `clinic` name — a tenant-scoped admin
  // must never see another clinic's log, so their own clinic is forced here
  // regardless of what ?clinic= they pass. Only a super-admin (no tenantId)
  // may filter across clinics.
  const clinic = user.tenantId ? user.clinic : searchParams.get('clinic');
  const q = searchParams.get('q');

  let sql = `SELECT * FROM audit_log WHERE 1=1`;
  const vals = [];
  if (action) {
    vals.push(action);
    sql += ` AND action=$${vals.length}`;
  }
  if (clinic) {
    vals.push(clinic);
    sql += ` AND clinic=$${vals.length}`;
  }
  if (q) {
    vals.push(`%${q}%`);
    sql += ` AND (resource ILIKE $${vals.length} OR user_name ILIKE $${vals.length})`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 200`;

  return Response.json(await query(sql, vals));
}
