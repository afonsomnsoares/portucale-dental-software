import { platformHealth } from '@/lib/platformStats';
import { withRoute } from '@/lib/route';

// Estado do sistema, em toda a rede. A medição vive em lib/platformStats.ts
// porque a página de plataforma também a faz, no servidor, sem passar por aqui.
export const GET = withRoute({ platform: true, tenant: 'optional' }, async () => {
  return Response.json(await platformHealth());
});
