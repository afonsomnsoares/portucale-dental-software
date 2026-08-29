import type { NextRequest } from 'next/server';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

// Managing tenants is a platform-level action, not a per-clinic one — restricted to the
// super-admin (role=admin with no tenantId; see lib/permissions.ts). A tenant-scoped
// admin passing role='admin' + hasPermission('tenants:manage') must not be able to list
// or create other clinics, so this checks !user.tenantId on top of the role/permission gate.
async function requireSuperAdmin(user: Parameters<typeof requireRoles>[0]) {
  if (!requireRoles(user, 'admin') || user?.tenantId) {
    await logBlockedAccess(user, 'Tenant management blocked: caller is not a super-admin');
    return false;
  }
  return hasPermission(user, 'tenants:manage');
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await requireSuperAdmin(user))) return forbidden();
  const rows = await query(
    `SELECT t.*, (SELECT COUNT(*) FROM patients p WHERE p.tenant_id=t.id)::int as patients
     FROM tenants t ORDER BY t.created_at`,
  );
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await requireSuperAdmin(user))) return forbidden();
  const { name, city, operatories } = await request.json();
  const ops = Math.max(1, Math.min(20, Number(operatories || 3)));
  const [t] = await query(
    `INSERT INTO tenants (name, city, operatories, status) VALUES ($1,$2,$3,'provisioning') RETURNING *`,
    [name, city, ops],
  );
  await appendAudit(user, 'PROVISION', `Tenant: ${name}`, null, 'provisioning');
  return Response.json(t, { status: 201 });
}
