import { appendAudit } from '@/lib/audit';
import { replyToConversation } from '@/lib/inbound';
import { withRoute } from '@/lib/route';

// A resposta de uma PESSOA. Ao contrário das automáticas, esta sai sempre — não passa
// por nível de autonomia nem por horário de silêncio, porque quem carregou no botão é
// que sabe se é boa altura.
export const POST = withRoute<{ id: string }>(
  { permission: 'conversations:reply' },
  async ({ request, user, tenantId, params }) => {
    const body = await request.json().catch(() => null);
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) return Response.json({ error: 'Mensagem vazia' }, { status: 400 });
    if (text.length > 4000) return Response.json({ error: 'Mensagem demasiado longa' }, { status: 400 });

    const result = await replyToConversation(tenantId, params.id, user.id, text);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    await appendAudit(user, 'CREATE', `Resposta na conversa ${params.id}`, null, 'ok', user.clinic);
    return Response.json(result.message, { status: 201 });
  },
);
