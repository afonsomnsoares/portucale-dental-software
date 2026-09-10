import { withRoute } from '@/lib/route';
import { computeSlotRisk } from '@/lib/slotRisk';

// Previsão de slot vazio, ao nível do slot. lib/forecast.ts já projeta cancelamentos e
// faltas ao nível do DIA — o que chega para planear pessoal e não chega para mais nada:
// ninguém pode contactar a lista de espera para "4 faltas". Isto diz qual é o lugar,
// em que cadeira e a que horas, e — a parte que faltava — se ainda haverá tempo de o
// encher quando cair.
export const GET = withRoute({ permission: 'schedule:read' }, async ({ request, tenantId }) => {
  const daysRaw = Number(new URL(request.url).searchParams.get('days') || 21);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 21;
  return Response.json(await computeSlotRisk(tenantId, days));
});
