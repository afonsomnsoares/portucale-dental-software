import { forbidden, requireRoles } from '@/lib/auth';
import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'audit:read', tenant: 'optional' }, async ({ request, user, tenantId }) => {
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  // audit_log has no tenant_id, only a `clinic` name — a tenant-scoped admin
  // must never see another clinic's log, so their own clinic is forced here
  // regardless of what ?clinic= they pass. Only a super-admin (no tenantId)
  // may filter across clinics.
  const clinic = tenantId ? user.clinic : searchParams.get('clinic');
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

  return Response.json(await queryRead(sql, vals));
});
