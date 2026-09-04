// Puro (só node:crypto) — testável sem rede nem base de dados.
//
// O webhook de SMS recebido (app/api/webhooks/sms/route.ts) é a única rota do
// produto que muda dados sem sessão nenhuma: não há cookie, não há utilizador, e
// com a política 'autobook' uma mensagem pode marcar uma consulta. Sem esta
// verificação, qualquer pessoa que descobrisse o URL marcava e desmarcava
// consultas em nome de quem quisesse, bastando-lhe conhecer um número de
// telemóvel.
//
// O esquema é o do Twilio: HMAC-SHA1, com a chave a ser o auth token da conta,
// sobre o URL completo seguido de cada par (chave, valor) do corpo
// form-encoded, concatenados por ordem alfabética da chave e sem separadores.

import crypto from 'node:crypto';

export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Comparação em tempo constante: uma comparação normal de strings desiste no
 * primeiro byte diferente, e o tempo que demora a desistir diz quantos bytes
 * estavam certos — o suficiente para adivinhar uma assinatura byte a byte.
 * `timingSafeEqual` exige comprimentos iguais, daí a verificação antes.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined,
): boolean {
  if (!authToken || !signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(String(signature), 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
