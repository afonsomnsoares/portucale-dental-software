/**
 * Converter um valor de coluna `DATE` do Postgres para `YYYY-MM-DD`.
 *
 * ─── O problema que isto existe para resolver ────────────────────────────────
 * O `node-postgres` devolve uma coluna `DATE` (OID 1082) como um `Date` do JS à
 * meia-noite *local*, não como string. Por isso o idioma que parecia óbvio:
 *
 *     String(row.appt_date).slice(0, 10)
 *
 * não devolve `"2026-08-05"` — devolve os dez primeiros caracteres de
 * `"Wed Aug 05 2026 00:00:00 GMT+0100 (WEST)"`, ou seja `"Wed Aug 05"`. E o pior
 * disto é o silêncio: nada estoira. O que acontece a seguir é tudo aparentemente
 * inofensivo e todo ele errado.
 *
 *   new Date(`${"Wed Aug 05"}T00:00:00Z`)   → Invalid Date
 *     .getUTCDay()                          → NaN   (nunca bate num Map 0–6)
 *   "Wed Aug 05" > "2026-01-01"             → true  (sempre; "W" > "2")
 *   [...].sort()                            → ordena por nome do mês, não por data
 *
 * Foi assim que as previsões devolveram zero durante meses (todas as observações
 * caíam em `parseDate → null`), que a lista de espera excluiu silenciosamente
 * quem tinha dias preferidos, e que os SMS saíram com a data em inglês.
 *
 * ─── Porquê ler os componentes LOCAIS ────────────────────────────────────────
 * O `Date` vem à meia-noite local, por isso é `getFullYear()/getMonth()/getDate()`
 * que recuperam o dia de calendário que estava na base de dados. Usar
 * `toISOString()` ou `getUTC*()` devolve o dia anterior em qualquer fuso a leste
 * de Greenwich — que é precisamente Portugal durante a hora de verão.
 *
 * ─── A primeira linha de defesa continua a ser o SQL ─────────────────────────
 * Onde a lista de colunas é nossa, o certo é pedir `appt_date::text` e nunca
 * chegar aqui com um `Date` (ver lib/scheduleOptimizer.ts, que já o fazia). Esta
 * função existe para o resto: `SELECT *`, agregados, e para que o dia em que
 * alguém voltar a escrever `String(...)` isto continue a dar a resposta certa.
 *
 * Coberto por test/pgDate.test.ts e pela varredura em
 * test/integration/date-shape.test.ts, que corre contra o Postgres a sério.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Devolve `YYYY-MM-DD`, ou `null` se o valor for nulo/ausente ou não representar
 * uma data. Nunca devolve uma string mal formada: ou é uma data ISO, ou é `null`.
 */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Componentes locais — ver o comentário do cabeçalho.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  if (typeof value === 'string') {
    const m = ISO_DATE.exec(value);
    // Só se aceita o que já vem em ISO. Uma string como "Wed Aug 05" é
    // exatamente o bug que isto apanha, e passá-la à frente seria repeti-lo.
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  return null;
}

/**
 * Como `isoDate`, mas para os sítios onde a ausência de data é um erro de
 * programação e não um caso de negócio — estoirar aqui é melhor do que propagar
 * um `"Invalid Date"` para dentro de um SMS ou de uma cláusula `WHERE`.
 */
export function requireIsoDate(value: unknown, field = 'date'): string {
  const iso = isoDate(value);
  if (iso === null) {
    throw new Error(
      `${field}: esperava-se uma data do Postgres e veio ${JSON.stringify(value)}. ` +
        `Se a coluna é DATE, pede-a como ${field}::text na query.`,
    );
  }
  return iso;
}
