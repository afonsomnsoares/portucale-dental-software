import { withRoute } from '@/lib/route';
import { computeAgendaEfficiency } from '@/lib/scheduleIntel';

export const GET = withRoute({ permission: 'schedule:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const data = await computeAgendaEfficiency(tenantId, days);
  return Response.json({ generatedAt: new Date().toISOString(), ...data });
});
