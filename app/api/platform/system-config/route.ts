import { systemConfig } from '@/lib/platformStats';
import { withRoute } from '@/lib/route';

// `platform: true` — sem ação associada, como a rota de health: a configuração
// técnica é do operador da plataforma e de mais ninguém. Um admin de clínica com
// 'reports:read' não tem nada que ver a lista de segredos configurados, mesmo
// sabendo que a resposta nunca traz os valores.
export const GET = withRoute({ platform: true, tenant: 'optional' }, async () => {
  return Response.json(await systemConfig());
});
