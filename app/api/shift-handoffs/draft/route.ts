import { withRoute } from '@/lib/route';
import { computeHandoffDraft } from '@/lib/shiftHandoff';

// Pré-preenchimento do compositor: o que está mesmo pendente na clínica agora.
// Sempre para o próprio utilizador — o rascunho inclui as tarefas de quem está a
// sair, e não há caso de uso para gerar o rascunho de outra pessoa.
export const GET = withRoute(
  { permission: 'shift-handoffs:manage', tenant: 'required' },
  async ({ user, tenantId }) => {
    const draft = await computeHandoffDraft(tenantId, user.id);
    return Response.json(draft);
  },
);
