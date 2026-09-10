import { appendAudit } from '@/lib/audit';
import { computeOrderReconciliation, freezeOrderReconciliation } from '@/lib/inventory';
import { withRoute } from '@/lib/route';

// As três versões de uma encomenda — o que se pediu, o que chegou, o que se pagou.
// GET compara; POST congela a comparação, e a partir daí ela deixa de ser recalculada:
// uma reconciliação é o que se concluiu naquele momento, não uma vista que muda sozinha
// quando alguém corrige o stock três semanas depois.
export const GET = withRoute<{ id: string }>({ permission: 'inventory:manage' }, async ({ tenantId, params }) => {
  const result = await computeOrderReconciliation(tenantId, params.id);
  return result ? Response.json(result) : Response.json({ error: 'Encomenda não encontrada' }, { status: 404 });
});

export const POST = withRoute<{ id: string }>(
  { permission: 'inventory:manage' },
  async ({ user, tenantId, params }) => {
    const result = await freezeOrderReconciliation(tenantId, params.id, user.id);
    if (!result) return Response.json({ error: 'Encomenda não encontrada' }, { status: 404 });
    await appendAudit(user, 'UPDATE', `Reconciliação da encomenda ${params.id}`, null, 'ok', user.clinic);
    return Response.json(result);
  },
);
