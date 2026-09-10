import { appendAudit } from '@/lib/audit';
import { forbidden, requireRoles, scopeTenant } from '@/lib/auth';
import { getPermissionMatrix, setPermissionOverrides } from '@/lib/permissions';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'permissions:manage', tenant: 'optional' }, async ({ request, user }) => {
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();

  const { searchParams } = new URL(request.url);
  // Only a super-admin (role=admin with no tenantId of their own) may pick a
  // tenant via the query string; a tenant-scoped admin is confined to their
  // own — matching the pattern used everywhere else (e.g. app/api/patients/route.ts)
  // and the check the PUT handler below already applies.
  const tenantId = scopeTenant(user, request, searchParams.get('tenantId'));
  if (!tenantId) return forbidden();

  const data = await getPermissionMatrix(tenantId);
  return Response.json({ tenantId, ...data });
});

export const PUT = withRoute({ permission: 'permissions:manage', tenant: 'optional' }, async ({ request, user }) => {
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();

  const { tenantId, updates } = await request.json();
  const tId = tenantId || user.tenantId;
  if (!tId) return forbidden();
  if (user.tenantId && user.tenantId !== tId) return forbidden();

  await setPermissionOverrides(tId, updates || []);
  await appendAudit(user, 'UPDATE', `Permissions — tenant ${tId}`, null, 'updated', user.clinic);

  const data = await getPermissionMatrix(tId);
  return Response.json({ tenantId: tId, ...data });
});
