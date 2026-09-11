import { aiUsage } from '@/lib/aiUsage';
import { withRoute } from '@/lib/route';

// Consumo da camada de agentes. O cálculo vive em lib/aiUsage.ts porque os
// painéis de plataforma também o leem, no servidor, sem passar por aqui.
export const GET = withRoute({ platform: 'agents:read', tenant: 'optional' }, async ({ request }) => {
  return Response.json(await aiUsage(new URL(request.url).searchParams.get('days')));
});
