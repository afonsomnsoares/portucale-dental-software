import { withRoute } from '@/lib/route';
import { computeRiskHeatmap } from '@/lib/scheduleIntel';

export const GET = withRoute({ permission: 'schedule:read', tenant: 'required' }, async ({ tenantId }) => {
  const data = await computeRiskHeatmap(tenantId);
  return Response.json({ generatedAt: new Date().toISOString(), ...data });
});
