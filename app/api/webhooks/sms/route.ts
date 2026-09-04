import type { NextRequest } from 'next/server';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { processInboundSms } from '@/lib/smsInbound';
import { verifyTwilioSignature } from '@/lib/twilioSignature';

// ─── A SEGUNDA ROTA NÃO AUTENTICADA DESTE PROJETO ──────────────────────────
//
// A outra é app/api/public/leads/route.ts, e as duas são não autenticadas pela
// mesma razão de fundo: do outro lado está alguém que não tem — nem pode ter —
// uma sessão da clínica. Aqui é um doente a responder a um SMS.
//
// A diferença, e é grande: aquela cria um lead; esta pode MARCAR UMA CONSULTA
// (com a política 'autobook', ver lib/schedulingPolicyCalc.ts). Por isso a
// autenticação não desaparece — muda de forma:
//
//   1. assinatura HMAC do Twilio em cada pedido (lib/twilioSignature.ts). Sem
//      TWILIO_AUTH_TOKEN configurado a rota recusa tudo: é a diferença entre
//      "ainda não está ligado" e "está aberto a qualquer pessoa";
//   2. o número de origem tem de corresponder a um doente (lib/smsInbound.ts);
//   3. só há uma decisão possível, e é sobre uma oferta que a clínica já tinha
//      enviado àquele doente — não se aceita nada que o sistema não tenha
//      proposto primeiro;
//   4. idempotência por MessageSid, porque o Twilio reentrega.
//
// Sem CORS (ao contrário da rota de leads): o Twilio chama de servidor para
// servidor, nenhum browser precisa disto.
//
// Também não chama requireSameOrigin() — e não pode: o pedido vem do Twilio,
// sem cookies e sem origem própria. A proteção CSRF que essa função dá não faz
// aqui sentido nenhum (não há sessão para atacar); o que a substitui é a
// assinatura do ponto 1.

const RATE_LIMIT = { limit: 60, windowMs: 60 * 1000 };

// TwiML vazio: "recebido, sem resposta a enviar".
function twiml(message?: string) {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`);
}

/**
 * O URL que o Twilio assinou. Atrás de um proxy, `request.url` é o URL interno
 * (http, host do contentor) e a assinatura nunca bateria certo — daí o override
 * explícito por variável de ambiente, e a reconstrução a partir dos cabeçalhos
 * do proxy como segunda opção.
 */
function signedUrl(request: NextRequest) {
  const configured = process.env.TWILIO_WEBHOOK_URL;
  if (configured) return configured;
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (proto && host) return `${proto}://${host}${new URL(request.url).pathname}`;
  return request.url;
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Fecha por omissão. Uma instalação sem SMS configurado não deve ter aqui um
    // buraco à espera de ser encontrado.
    console.warn('[sms-webhook] recebido sem TWILIO_AUTH_TOKEN configurado — recusado');
    return new Response('Not configured', { status: 503 });
  }

  const rl = rateLimit(`sms-webhook:${getClientIp(request)}`, RATE_LIMIT);
  if (!rl.ok) return new Response('Too many requests', { status: 429 });

  const form = await request.formData().catch(() => null);
  if (!form) return new Response('Bad request', { status: 400 });

  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;

  if (!verifyTwilioSignature(authToken, signedUrl(request), params, request.headers.get('x-twilio-signature'))) {
    console.warn('[sms-webhook] assinatura inválida — pedido recusado');
    return new Response('Invalid signature', { status: 403 });
  }

  const from = String(params.From || '').trim();
  const body = String(params.Body || '');
  const providerId = String(params.MessageSid || '') || null;
  if (!from) return twiml();

  try {
    const result = await processInboundSms({ from, body, providerId });

    // A resposta ao doente. Só se responde quando há uma conclusão para lhe dar:
    // uma marcação feita, ou o registo de que se percebeu. Quando a mensagem vai
    // para uma pessoa ler, é essa pessoa que responde — uma resposta automática
    // a dizer "não percebi" a alguém que escreveu uma frase inteira é pior do
    // que o silêncio de dois minutos até alguém ligar.
    if (result.booked) return twiml('Confirmado. Enviámos os detalhes e ficamos à espera de si. Obrigado!');
    if (result.intent === 'decline')
      return twiml('Sem problema, obrigado por avisar. Continuamos atentos a outra vaga.');
    if (result.intent === 'accept') return twiml('Recebido! A receção confirma consigo em breve.');
    return twiml();
  } catch (e) {
    // Um erro aqui não pode devolver 500 ao Twilio sem mais nada: ele reentrega,
    // e a reentrega repetida de uma mensagem que rebenta sempre é ruído infinito.
    // O erro fica no log do servidor, que é onde se investiga.
    console.error('[sms-webhook] falha a processar:', e instanceof Error ? e.message : e);
    return twiml();
  }
}
