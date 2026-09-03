import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeHandoffDraft } from '@/lib/shiftHandoff';

// Pré-preenchimento do compositor: o que está mesmo pendente na clínica agora.
// Sempre para o próprio utilizador — o rascunho inclui as tarefas de quem está a
// sair, e não há caso de uso para gerar o rascunho de outra pessoa.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'shift-handoffs:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const draft = await computeHandoffDraft(user.tenantId, user.id);
  return Response.json(draft);
}
