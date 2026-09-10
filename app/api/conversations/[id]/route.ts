import { appendAudit } from '@/lib/audit';
import { CONVERSATION_STATES, type ConversationState } from '@/lib/conversationCalc';
import { getConversation, setConversationState } from '@/lib/inbound';
import { withRoute } from '@/lib/route';

export const GET = withRoute<{ id: string }>({ permission: 'conversations:read' }, async ({ tenantId, params }) => {
  const result = await getConversation(tenantId, params.id);
  return result ? Response.json(result) : Response.json({ error: 'Conversa não encontrada' }, { status: 404 });
});

// Mudar o estado. A máquina de estados é validada no servidor, como a das consultas —
// transições inválidas dão 400 em vez de gravarem um estado sem significado.
export const PATCH = withRoute<{ id: string }>(
  { permission: 'conversations:reply' },
  async ({ request, user, tenantId, params }) => {
    const body = await request.json().catch(() => null);
    const state = body?.state;
    if (!state || !(CONVERSATION_STATES as readonly string[]).includes(state)) {
      return Response.json({ error: `state tem de ser: ${CONVERSATION_STATES.join(', ')}` }, { status: 400 });
    }
    const result = await setConversationState(tenantId, params.id, state as ConversationState);
    if ('ok' in result && result.ok === false) return Response.json({ error: result.error }, { status: result.status });
    await appendAudit(user, 'UPDATE', `Conversa ${params.id} → ${state}`, null, 'ok', user.clinic);
    return Response.json(result);
  },
);
