import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { computeLifecyclePipeline, listOpenLeads } from '@/lib/lifecycle';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'lifecycle:read'))) return forbidden();

  const requestedTenantId = new URL(request.url).searchParams.get('tenantId');
  const tenantId = user.role === 'admin' && !user.tenantId ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const tenant = await queryOne(`SELECT id FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return Response.json({ error: 'Not found' }, { status: 404 });

  const [{ stages }, leads] = await Promise.all([computeLifecyclePipeline(tenantId), listOpenLeads(tenantId)]);

  return Response.json({ generatedAt: new Date().toISOString(), leads, stages });
}
