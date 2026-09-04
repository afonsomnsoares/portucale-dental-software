// Puro — sem imports de DB nem de rede, testável como lib/waitlistMatch.ts.
//
// O produto manda "responda SIM para confirmar" desde a primeira versão do
// risco de falta (lib/jobsRunner.ts, queueRiskOutreach), mas nunca houve nada do
// outro lado a ler a resposta: o SIM caía numa caixa que ninguém abria. Isto é a
// leitura dessa resposta.
//
// ─── Porque é que isto é conservador de propósito ──────────────────────────
//
// Do outro lado desta função pode estar uma marcação automática (política
// 'autobook', ver lib/schedulingPolicyCalc.ts). Os dois erros possíveis não
// custam o mesmo:
//
//   ler "não" como "sim"  → marca-se uma consulta que o doente recusou, a
//                           cadeira fica ocupada e vazia, e alguém tem de ligar
//                           a desfazer o mal-entendido;
//   ler "sim" como dúvida → a mensagem vai para a receção e uma pessoa lê.
//
// Por isso qualquer ambiguidade é 'unknown', e 'unknown' nunca marca nada: vira
// tarefa para uma pessoa. Uma mensagem com "sim" e "não" na mesma frase ("sim
// mas não antes das 18") é exatamente o caso em que um humano é insubstituível.

export type SmsIntent = 'accept' | 'decline' | 'stop' | 'unknown';

/**
 * Minúsculas, sem acentos, sem pontuação, espaços colapsados. Sem acentos
 * porque metade das respostas por SMS vem sem eles ("nao", "confirmacao") e
 * tratar "não" e "nao" como palavras diferentes seria escolher perder metade.
 */
export function normalizeSms(body: unknown): string {
  return String(body ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Revogação de consentimento. Primeiro que tudo o resto: "STOP" é um direito do
// doente e não pode depender de o resto da frase se perceber.
const STOP_PATTERNS = [
  /\bstop\b/,
  /\bunsubscribe\b/,
  /\bparar\b/,
  /\bcancelar (as )?(mensagens|sms)\b/,
  /\bnao (me )?(mandem|enviem|contactem|liguem)\b/,
  /\bnao quero (mais )?(receber|mensagens|sms)\b/,
  /\bremover( me)?\b/,
  /\bsair\b/,
];

// Negações explícitas. Testadas ANTES das aceitações porque "não quero" contém
// "quero" e "não posso" contém "posso" — a ordem inversa lia toda a recusa
// educada como aceitação.
const DECLINE_PATTERNS = [
  /^n$/,
  /^no$/,
  /\bnao\b/,
  /\bnegativo\b/,
  /\bnunca\b/,
  /\bimpossivel\b/,
  /\bdesmarcar\b/,
  /\brecuso\b/,
  /\boutro (dia|horario)\b/,
];

const ACCEPT_PATTERNS = [
  /^s$/,
  /\bsim\b/,
  /\bok\b/,
  /\bokay\b/,
  /\byes\b/,
  /\bconfirmo\b/,
  /\bconfirmado\b/,
  /\bconfirma\b/,
  /\baceito\b/,
  /\bquero\b/,
  /\bpode ser\b/,
  /\bcombinado\b/,
  /\bclaro\b/,
  /\bfico com\b/,
];

// Aceitações com condição agarrada: "sim mas só depois das 18", "ok se for com
// a Dra. Costa", "pode ser? a que horas". Não são recusas — são conversa, e uma
// conversa não se resolve marcando a consulta que a pessoa acabou de pôr em
// causa. Vão todas para uma pessoa.
//
// Este caso não tem negação nenhuma, e por isso escapava à regra da ambiguidade
// (que só dispara quando há recusa E aceitação): sem esta lista, "sim mas só
// depois das 18" era lido como um SIM seco e marcava as 11:00.
const QUALIFIER_PATTERNS = [
  /\bmas\b/,
  /\bso\b/,
  /\bapenas\b/,
  /\bdesde que\b/,
  /\btalvez\b/,
  /\bse possivel\b/,
  /\bprefiro\b/,
  /\boutra\b/,
  /\b(antes|depois) (das|de)\b/,
  /\ba que horas\b/,
  /\bcom (o|a) (dr|dra|doutor|doutora)\b/,
];

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((p) => p.test(text));
}

// "não quero", "nunca consigo", "não vou poder": a negação está agarrada ao
// verbo de aceitação, e as duas listas acima veem uma recusa E uma aceitação na
// mesma frase — que é a definição de ambíguo, quando na verdade é a recusa mais
// clara que há. Estas expressões são colapsadas para a negação seca antes de se
// procurarem aceitações, para a ambiguidade ficar reservada a quem a merece
// ("sim mas não antes das 18").
const NEGATED_ACCEPT =
  /\b(?:nao|nunca)\s+(?:\w+\s+){0,2}?(?:sim|ok|okay|yes|confirmo|confirmado|confirma|aceito|quero|posso|consigo|vou|pode|da|fico)\b/g;

/**
 * A intenção de uma resposta. 'unknown' não é falha — é a resposta correta para
 * tudo o que não seja inequívoco, e o caminho dela é uma pessoa.
 */
export function parseSmsReply(body: unknown): SmsIntent {
  const text = normalizeSms(body);
  if (!text) return 'unknown';

  if (matchesAny(text, STOP_PATTERNS)) return 'stop';

  const declines = matchesAny(text, DECLINE_PATTERNS);
  const accepts = matchesAny(text.replace(NEGATED_ACCEPT, 'nao'), ACCEPT_PATTERNS);

  // "sim mas não consigo às 14" — as duas coisas ao mesmo tempo é precisamente
  // o caso que uma pessoa tem de ler.
  if (declines && accepts) return 'unknown';
  if (declines) return 'decline';
  // Uma pergunta é sempre uma pergunta, mesmo que comece por "sim". A
  // interrogação é procurada no texto cru porque a normalização tira a
  // pontuação toda.
  if (accepts && (matchesAny(text, QUALIFIER_PATTERNS) || String(body ?? '').includes('?'))) return 'unknown';
  if (accepts) return 'accept';
  return 'unknown';
}

export const INTENT_LABEL_PT: Record<SmsIntent, string> = {
  accept: 'Aceitou',
  decline: 'Recusou',
  stop: 'Pediu para não ser contactado',
  unknown: 'Por interpretar',
};
