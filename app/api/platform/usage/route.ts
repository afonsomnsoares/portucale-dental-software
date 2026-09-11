import { tenantUsage } from '@/lib/platformStats';
import { withRoute } from '@/lib/route';

// Utilização real por clínica. A consulta vive em lib/platformStats.ts porque as
// páginas de plataforma também a leem, no servidor, sem passar por aqui.
export const GET = withRoute({ platform: 'reports:read', tenant: 'optional' }, async () => {
  return Response.json(await tenantUsage());
});
