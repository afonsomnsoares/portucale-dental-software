import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { getPermissionMatrix, hasPermission, setPermissionOverrides } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  if (!(await hasPermission(user, 'permissions:manage'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId') || user.tenantId;
  if (!tenantId) return forbidden();

  const data = await getPermissionMatrix(tenantId);
  return Response.json({ tenantId, ...data });
}

export async function PUT(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  if (!(await hasPermission(user, 'permissions:manage'))) return forbidden();

  const { tenantId, updates } = await request.json();
  const tId = tenantId || user.tenantId;
  if (!tId) return forbidden();
  if (user.tenantId && user.tenantId !== tId) return forbidden();

  await setPermissionOverrides(tId, updates || []);
  await appendAudit(user, 'UPDATE', `Permissions — tenant ${tId}`, null, 'updated', user.clinic);

  const data = await getPermissionMatrix(tId);
  return Response.json({ tenantId: tId, ...data });
}
