import { clampHorizon, computeForecasts } from '@/lib/forecast';
import { withRoute } from '@/lib/route';

// GET /api/forecast?days=14 — as seis previsões da clínica.
//
// Exige 'reports:read' e não uma ação nova: prever é ler o negócio, e quem pode ver os
// relatórios da clínica pode ver para onde eles apontam. Uma permissão a mais que
// ninguém sabe atribuir é uma funcionalidade que ninguém usa.
export const GET = withRoute({ permission: 'reports:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const days = clampHorizon(searchParams.get('days'));
  return Response.json(await computeForecasts(tenantId, days));
});
