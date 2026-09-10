import { forbidden, scopeTenant } from '@/lib/auth';
import { withRoute } from '@/lib/route';
import { computeRiskHeatmap } from '@/lib/scheduleIntel';

export const GET = withRoute({ permission: 'schedule:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const data = await computeRiskHeatmap(tenantId);
  return Response.json({ generatedAt: new Date().toISOString(), ...data });
});
