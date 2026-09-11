import { computeForecasts, DEFAULT_HORIZON_DAYS } from '@/lib/forecast';
import { withRoute } from '@/lib/route';

// GET /api/forecast?days=14 — as seis previsões da clínica.
//
// Exige 'reports:read' e não uma ação nova: prever é ler o negócio, e quem pode ver os
// relatórios da clínica pode ver para onde eles apontam. Uma permissão a mais que
// ninguém sabe atribuir é uma funcionalidade que ninguém usa.
export const GET = withRoute({ permission: 'reports:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);

  // Teto de 90 dias: acima disso a previsão sazonal está a extrapolar 13 semanas a
  // partir de 12 de histórico, e o número deixa de significar o que aparenta.
  const raw = Number(searchParams.get('days') || DEFAULT_HORIZON_DAYS);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(90, Math.floor(raw))) : DEFAULT_HORIZON_DAYS;

  return Response.json(await computeForecasts(tenantId, days));
});
