import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { twilioRequestUrl, verifyTwilioSignature } from '../lib/twilioSignature.ts';

// ─── O que este teste fixa, e porquê não é uma constante decorada ───────────
// A parte do algoritmo da Twilio que se pode implementar mal sem dar por isso é a
// construção da string assinada: URL completo (com query string), parâmetros ordenados
// por nome, nome e valor colados sem separador nenhum. O HMAC-SHA1 em base64 que vem a
// seguir é padrão e não tem variantes.
//
// Por isso o que aqui está fixo é a STRING, escrita à mão a partir da especificação —
// e a assinatura esperada é o HMAC dessa string, calculado no teste. Uma implementação
// que ordenasse por outro critério, que deixasse cair o `?foo=1&bar=2` ou que metesse
// um separador entre os pares produz uma string diferente, um HMAC diferente, e falha
// aqui. Uma constante copiada não diria mais do que isto e diria pior: se estivesse
// errada, o teste passaria a exigir que o código errasse da mesma maneira.
const AUTH_TOKEN = '12345';
const URL_WITH_QUERY = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = {
  // De propósito fora de ordem alfabética no objeto: é a ordenação feita pelo código
  // que tem de casar com a string abaixo, não a ordem por que os campos aparecem.
  To: '+18005551212',
  CallSid: 'CA1234567890ABCDE',
  From: '+14158675309',
  Caller: '+14158675309',
  Digits: '1234',
};

// URL + (nome + valor) por ordem alfabética do nome, tudo colado.
const EXPECTED_SIGNED_STRING =
  'https://mycompany.com/myapp.php?foo=1&bar=2' +
  'CallSidCA1234567890ABCDE' +
  'Caller+14158675309' +
  'Digits1234' +
  'From+14158675309' +
  'To+18005551212';

const VALID_SIGNATURE = createHmac('sha1', AUTH_TOKEN).update(Buffer.from(EXPECTED_SIGNED_STRING, 'utf-8')).digest('base64');

const TWILIO_DOC = {
  url: URL_WITH_QUERY,
  authToken: AUTH_TOKEN,
  params: PARAMS,
  signature: VALID_SIGNATURE,
};

test('aceita a assinatura calculada sobre a string que a especificação descreve', () => {
  assert.equal(
    verifyTwilioSignature({
      url: TWILIO_DOC.url,
      params: TWILIO_DOC.params,
      signature: TWILIO_DOC.signature,
      authToken: TWILIO_DOC.authToken,
    }),
    true,
  );
});

test('a ordem dos parâmetros no objeto não muda a assinatura', () => {
  // Reordenado à mão: se o código dependesse da ordem de inserção em vez de ordenar,
  // isto falhava — e falhava só em produção, onde a ordem vem do corpo do pedido.
  const reordered = {
    Digits: PARAMS.Digits,
    To: PARAMS.To,
    Caller: PARAMS.Caller,
    CallSid: PARAMS.CallSid,
    From: PARAMS.From,
  };
  assert.equal(verifyTwilioSignature({ ...TWILIO_DOC, params: reordered }), true);
});

test('recusa quando o auth token é outro', () => {
  assert.equal(
    verifyTwilioSignature({ ...TWILIO_DOC, authToken: '12346' }),
    false,
  );
});

test('recusa quando um parâmetro foi alterado', () => {
  // O caso que o HMAC existe para apanhar: a assinatura continua a mesma, o conteúdo
  // não. Um esquema de segredo estático — o que aqui estava antes — aceitaria isto.
  assert.equal(
    verifyTwilioSignature({
      ...TWILIO_DOC,
      params: { ...TWILIO_DOC.params, From: '+19995550000' },
    }),
    false,
  );
});

test('recusa quando o URL é outro', () => {
  assert.equal(verifyTwilioSignature({ ...TWILIO_DOC, url: 'https://mycompany.com/myapp.php?foo=1' }), false);
});

test('recusa assinatura vazia e token vazio', () => {
  assert.equal(verifyTwilioSignature({ ...TWILIO_DOC, signature: '' }), false);
  assert.equal(verifyTwilioSignature({ ...TWILIO_DOC, authToken: '' }), false);
});

test('não rebenta com uma assinatura de comprimento diferente', () => {
  // timingSafeEqual lança se os buffers tiverem tamanhos diferentes. Sem o teste de
  // comprimento, isto seria um 500 em vez de um 403 — e um 500 provocável por quem
  // manda um cabeçalho curto é uma forma barata de encher o log de erros.
  assert.equal(verifyTwilioSignature({ ...TWILIO_DOC, signature: 'abc' }), false);
});

// ─── O URL assinado atrás de um proxy ───────────────────────────────────────
// É aqui que uma integração da Twilio falha em produção depois de passar em dev: a
// Twilio assina o URL público, o Next vê o host interno do Compose, e o HMAC nunca bate
// certo. O sintoma é indistinguível de uma assinatura forjada.
test('twilioRequestUrl prefere PUBLIC_BASE_URL e mantém caminho e query', () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://clinica.exemplo.pt';
  try {
    const request = new Request('http://app:3000/api/webhooks/sms?x=1');
    assert.equal(twilioRequestUrl(request), 'https://clinica.exemplo.pt/api/webhooks/sms?x=1');
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});

test('twilioRequestUrl cai nos cabeçalhos do proxy quando não há PUBLIC_BASE_URL', () => {
  const previous = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  try {
    const request = new Request('http://app:3000/api/webhooks/voice', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'clinica.exemplo.pt' },
    });
    assert.equal(twilioRequestUrl(request), 'https://clinica.exemplo.pt/api/webhooks/voice');
  } finally {
    if (previous !== undefined) process.env.PUBLIC_BASE_URL = previous;
  }
});

test('twilioRequestUrl ignora um PUBLIC_BASE_URL mal formado em vez de rebentar', () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'isto-não-é-um-url';
  try {
    const request = new Request('http://localhost:3000/api/webhooks/sms', {
      headers: { host: 'localhost:3000' },
    });
    assert.equal(twilioRequestUrl(request), 'http://localhost:3000/api/webhooks/sms');
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});
