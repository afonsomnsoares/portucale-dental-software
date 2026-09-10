import { forbidden, scopeTenant } from '@/lib/auth';
import { withRoute } from '@/lib/route';
import { computeAgendaEfficiency } from '@/lib/scheduleIntel';

export const GET = withRoute({ permission: 'schedule:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const data = await computeAgendaEfficiency(tenantId, days);
  return Response.json({ generatedAt: new Date().toISOString(), ...data });
});
