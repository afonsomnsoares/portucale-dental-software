import { CONVERSATION_STATE_LABELS, CONVERSATION_STATES } from '@/lib/conversationCalc';
import { listConversations } from '@/lib/inbound';
import { withRoute } from '@/lib/route';

// A caixa de entrada. Ordenada por urgência e não por data: escalados primeiro, depois
// o que espera por nós, depois o resto — uma caixa que misture o que já respondemos com
// o que não é uma caixa que ninguém consegue esvaziar.
export const GET = withRoute({ permission: 'conversations:read' }, async ({ request, tenantId }) => {
  const state = new URL(request.url).searchParams.get('state');
  if (state && !(CONVERSATION_STATES as readonly string[]).includes(state)) {
    return Response.json({ error: `state tem de ser: ${CONVERSATION_STATES.join(', ')}` }, { status: 400 });
  }
  const conversations = await listConversations(tenantId, state || undefined);
  return Response.json({ conversations, states: CONVERSATION_STATE_LABELS });
});
