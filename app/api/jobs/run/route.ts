import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { type JobName, runJob } from '@/lib/jobsRunner';
import { hasPermission } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  if (!(await hasPermission(user, 'jobs:run'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const job = (searchParams.get('job') || 'all') as JobName;
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'admin' && !user.tenantId ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const result = await runJob(tenantId, job, { id: user.id, name: user.name, role: user.role, clinic: user.clinic });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 500 });
  return Response.json(result);
}
