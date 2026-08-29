import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeRiskHeatmap } from '@/lib/scheduleIntel';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'schedule:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'admin' && !user.tenantId ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const data = await computeRiskHeatmap(tenantId);
  return Response.json({ generatedAt: new Date().toISOString(), ...data });
}
