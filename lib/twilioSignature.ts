import crypto from 'node:crypto';

// ─── Validação da assinatura real da Twilio ─────────────────────────────────
// O que aqui estava antes tratava o `X-Twilio-Signature` como se fosse um segredo
// estático: lia o cabeçalho e comparava o seu hash com o `secret_hash` guardado. Isso
// não podia funcionar nem por acaso — a assinatura da Twilio MUDA a cada pedido,
// porque é um HMAC sobre o URL e os parâmetros desse pedido. O efeito prático era um
// 403 em todos os webhooks da Twilio, com o código a dar a entender que o canal estava
// protegido por uma verificação que nunca chegava a acontecer.
//
// O algoritmo é o que a Twilio publica e não se escolhe:
//   1. partir do URL COMPLETO a que o pedido foi feito, tal como a Twilio o conhece;
//   2. ordenar os parâmetros do corpo (form-encoded) por nome;
//   3. concatenar ao URL, para cada um, o nome seguido do valor, sem separadores;
//   4. HMAC-SHA1 dessa string com o auth token da conta, em base64.
//
// ─── O auth token vem do ambiente, não da base de dados ─────────────────────
// É o MESMO token que lib/sms.ts já usa para ENVIAR (TWILIO_AUTH_TOKEN): a Twilio
// assina a entrada com a credencial da conta. Guardá-lo outra vez numa coluna seria
// duplicar um segredo — e, ao contrário do `secret_hash`, teria de ficar recuperável,
// ou seja, legível por quem tenha leitura na base. Fica onde os segredos deste projeto
// ficam: no ambiente do servidor.

/**
 * O URL que a Twilio assinou. Não é `request.url`: atrás do Caddy (ver o Caddyfile) o
 * Next vê `http://app:3000/...` — o host interno do Compose — enquanto a Twilio assinou
 * `https://clinica.exemplo.pt/...`. Usar o primeiro faz o HMAC nunca bater certo, e o
 * sintoma seria indistinguível de uma assinatura forjada.
 *
 * `PUBLIC_BASE_URL` quando existe, porque é declarado e não adivinhado. Sem ela,
 * reconstrói-se a partir dos cabeçalhos que o proxy escreveu — o que só é de confiar
 * porque há um proxy declarado (TRUSTED_PROXY_HOPS); sem ele, quem chama escolhe o
 * host e escolheria com ele a string que vai ser assinada.
 */
export function twilioRequestUrl(request: Request): string {
  const original = new URL(request.url);
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) {
    try {
      const base = new URL(configured);
      // Só o esquema e a autoridade vêm da configuração; o caminho e a query são os
      // deste pedido, que é o que a Twilio assinou.
      return new URL(original.pathname + original.search, base).toString();
    } catch {
      // URL mal formado na configuração: cai para os cabeçalhos abaixo em vez de
      // rebentar. Um erro de configuração não deve derrubar o canal de entrada.
    }
  }
  const proto = request.headers.get('x-forwarded-proto') || original.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || original.host;
  return `${proto}://${host}${original.pathname}${original.search}`;
}

/**
 * Verifica a assinatura de um webhook da Twilio.
 *
 * `params` são os campos do corpo form-encoded. Um corpo em JSON não leva parâmetros na
 * string assinada (a Twilio não envia JSON nos webhooks de SMS/voz), por isso um mapa
 * vazio é a leitura correta nesse caso — e a assinatura simplesmente não baterá certo,
 * que é o resultado seguro.
 */
export function verifyTwilioSignature({
  url,
  params,
  signature,
  authToken,
}: {
  url: string;
  params: Record<string, unknown>;
  signature: string;
  authToken: string;
}): boolean {
  if (!signature || !authToken) return false;

  // Ordenação por nome do parâmetro, que é o que a Twilio especifica. `sort()` sem
  // comparador ordena por unidade de código UTF-16 — o mesmo critério que a
  // implementação de referência usa.
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);

  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

  // Comparação em tempo constante, como em todo o resto do projeto. O length check
  // antes do timingSafeEqual é obrigatório: a função lança se os buffers diferirem em
  // tamanho, e um throw aqui seria um 500 em vez de um 403.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
