import { withRoute } from '@/lib/route';
import { getSchedulingPolicy, saveSchedulingPolicy } from '@/lib/schedulingPolicy';

// A fronteira do agente de agenda, editável pela clínica (migração 046).
//
// Ler é 'schedule:read' porque quem trabalha na agenda tem de poder saber se o
// software está a contactar doentes nas costas dele. Escrever é
// 'scheduling-agent:manage': mudar isto muda o que a clínica faz sem ninguém
// presente.
export const GET = withRoute({ permission: 'schedule:read', tenant: 'resolved' }, async ({ tenantId }) => {
  if (!tenantId) return Response.json({ error: 'tenantId é obrigatório' }, { status: 400 });
  return Response.json(await getSchedulingPolicy(tenantId));
});

export const PUT = withRoute(
  { permission: 'scheduling-agent:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    if (!tenantId) return Response.json({ error: 'tenantId é obrigatório' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    return Response.json(await saveSchedulingPolicy(tenantId, user, body || {}));
  },
);
