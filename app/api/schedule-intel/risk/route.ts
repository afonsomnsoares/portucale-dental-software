import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeUpcomingRisk } from '@/lib/scheduleIntel';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'schedule:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'super_admin' ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const { scored, highRisk } = await computeUpcomingRisk(tenantId, days);
  return Response.json({ generatedAt: new Date().toISOString(), days, appointments: scored, highRisk });
}
