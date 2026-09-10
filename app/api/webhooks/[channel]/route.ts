import type { NextRequest } from 'next/server';
import { isConversationChannel } from '@/lib/conversationCalc';
import { enterTenantContext } from '@/lib/db';
import { handleInbound, resolveChannelAccount } from '@/lib/inbound';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { withRoute } from '@/lib/route';

// ═══ A rota mais exposta da aplicação ═══════════════════════════════════════
// Um endpoint público que aceita conteúdo de terceiros e escreve na base de dados de
// uma clínica. Não usa withRoute porque não há sessão nenhuma — o chamador é a Twilio,
// a Meta ou um widget de chat — e por isso todas as garantias que withRoute dá de
// graça têm de ser feitas aqui, à mão e por escrito:
//
//   1. NÃO HÁ TENANT NO PEDIDO. A clínica é resolvida a partir do endereço de DESTINO
//      (o número da clínica que recebeu a mensagem), contra channel_accounts. Aceitar
//      um tenantId do corpo seria oferecer um seletor de clínica a quem chama.
//   2. A ASSINATURA É OBRIGATÓRIA. Verificada contra o segredo da conta de canal, em
//      tempo constante. Uma conta sem segredo configurado é recusada — um webhook que
//      aceita qualquer coisa é pior do que um que não existe, porque parece protegido.
//   3. RATE LIMIT PRÓPRIO. O teto genérico do proxy conta por IP, e o IP aqui é o
//      do fornecedor: todas as clínicas partilhariam o mesmo balde e uma inundação
//      numa calaria as outras. A chave é o endereço de destino, ou seja, a clínica.
//   4. RESPOSTA SEMPRE 200 QUANDO A MENSAGEM FOI ACEITE. Os fornecedores reenviam o
//      que não recebe 200 — e uma reentrega que crie uma segunda tarefa é um bug que
//      só aparece em produção. A deduplicação por provider_id em lib/inbound.ts fecha
//      o outro lado da mesma porta.
//
// Dois canais: `sms` e `voice`. Uma chamada entra aqui como TRANSCRIÇÃO do que alguém
// disse ao telefone, e nunca recebe resposta automática — devolve-se com o telefone na
// mão (ver allowsAutoReply em lib/conversationCalc.ts). Qualquer outro valor no caminho
// dá 404 antes de se tocar na base de dados.
//
// O corpo NUNCA é interpretado como instrução. É texto de um doente: classifica-se com
// um classificador determinístico (lib/conversationCalc.ts) e, quando a clínica ligou
// a autonomia, um modelo pode refinar — mas nem o classificador nem o modelo podem
// levar o sistema a responder a assuntos clínicos ou a ignorar um pedido de não
// contacto. Essas duas regras não passam por aqui.

const WEBHOOK_LIMIT = { limit: 120, windowMs: 60 * 1000 };

// Cada fornecedor põe a assinatura num cabeçalho diferente. A lista é explícita para
// que um fornecedor novo obrigue a uma linha aqui, em vez de o código aceitar qualquer
// cabeçalho que se pareça com um segredo.
function extractSecret(request: NextRequest): string | null {
  return request.headers.get('x-portucale-signature') || request.headers.get('x-twilio-signature') || null;
}

// Normaliza o que cada fornecedor chama às mesmas quatro coisas. Deliberadamente
// tolerante na leitura e estrito na validação a seguir: um campo em falta dá 400 com o
// nome do campo, e não um registo silencioso com uma string vazia.
function parsePayload(channel: string, body: Record<string, unknown>) {
  // `TranscriptionText` e `SpeechResult` são os campos por onde a Twilio entrega o que
  // foi dito numa chamada. Ler os dois aqui, com os genéricos, evita um segundo
  // normalizador só para voz.
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  return {
    toAddress: pick('To', 'to', 'recipient', 'to_address'),
    fromAddress: pick('From', 'from', 'sender', 'from_address'),
    fromName: pick('ProfileName', 'fromName', 'name') || null,
    body: pick('Body', 'body', 'text', 'message', 'TranscriptionText', 'SpeechResult'),
    providerId: pick('MessageSid', 'CallSid', 'messageId', 'id', 'provider_id') || null,
    channel,
  };
}

export const POST = withRoute<{ channel: string }>({ public: true, crossOrigin: true }, async ({ request, params }) => {
  const { channel } = params;
  if (!isConversationChannel(channel)) {
    return Response.json({ error: 'Unknown channel' }, { status: 404 });
  }

  // O corpo pode vir como JSON ou como formulário (a Twilio usa formulário). Ler os
  // dois evita que a integração falhe por uma razão que não tem nada a ver com a
  // lógica.
  const contentType = request.headers.get('content-type') || '';
  let raw: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const form = await request.formData().catch(() => null);
    if (form) raw = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
  }

  const msg = parsePayload(channel, raw);
  if (!msg.toAddress) return Response.json({ error: 'Missing destination address' }, { status: 400 });
  if (!msg.fromAddress) return Response.json({ error: 'Missing sender address' }, { status: 400 });

  // Rate limit por clínica (endereço de destino) e não por IP — ver o ponto 3 acima.
  const rl = rateLimit(`webhook:${channel}:${msg.toAddress}`, WEBHOOK_LIMIT);
  if (!rl.ok) {
    console.warn(`[webhook] rate limited ${channel} to=${msg.toAddress} ip=${getClientIp(request)}`);
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }

  const account = await resolveChannelAccount(channel, msg.toAddress, extractSecret(request));
  if (!account.ok) {
    // Não distingue "endereço desconhecido" de "assinatura errada" no corpo, pela mesma
    // razão que o login não distingue email inexistente de password errada: as duas
    // respostas juntas são um oráculo para descobrir que números pertencem a clínicas.
    console.warn(`[webhook] rejeitado ${channel} to=${msg.toAddress}: ${account.error}`);
    return Response.json({ error: 'Rejected' }, { status: account.status === 404 ? 403 : account.status });
  }

  // A partir daqui há clínica, e portanto há contexto de RLS. Sem esta chamada, as
  // políticas da migração 011 veriam o sentinela "nenhum tenant" e recusariam todas as
  // escritas — que é o comportamento correto por omissão, e é por isso que estabelecer
  // o contexto é um passo explícito e não uma coisa que acontece sozinha.
  enterTenantContext({ tenantId: account.tenantId, role: 'system' });

  // Uma mensagem sem texto continua a ser um contacto do doente e tem de aparecer na
  // caixa de entrada — só não tem nada para classificar. Numa chamada isso é o caso
  // comum: uma chamada não atendida, ou uma em que a transcrição falhou, é exatamente a
  // que mais precisa de aparecer a alguém.
  const result = await handleInbound(account.tenantId, {
    channel,
    toAddress: msg.toAddress,
    fromAddress: msg.fromAddress,
    fromName: msg.fromName,
    body: msg.body || (channel === 'voice' ? '[chamada sem transcrição]' : '[mensagem sem texto]'),
    providerId: msg.providerId,
  });

  return Response.json({ ok: true, conversationId: result.conversationId, duplicate: result.duplicate });
});
