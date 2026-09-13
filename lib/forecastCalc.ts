// Previsão — lógica pura, sem DB, testável como lib/noShowRisk.ts e lib/recoveryCalc.ts.
//
// O bloco 5 da visão pede seis previsões (receita, ocupação, procura, cancelamentos,
// faltas, capacidade). Todas partilham a mesma forma: uma série diária de observações
// passadas, e uma pergunta sobre os próximos N dias. Por isso existe UM motor, e cada
// métrica é só uma série diferente a entrar nele.
//
// ─── Porquê este método e não uma regressão ────────────────────────────────────
// Uma clínica tem sazonalidade semanal fortíssima (segunda não é sábado) e histórico
// curto — meses, não anos. Uma regressão sobre o tempo ignora o dia da semana; uma
// média móvel simples achata-o. O que se usa aqui é o "seasonal naïve" com tendência:
//
//   previsão(dia) = mediana dos mesmos dias-da-semana recentes × fator de tendência
//
// Mediana e não média porque um único dia excecional (um sábado de campanha, uma
// avaria que fechou a clínica) não pode arrastar a previsão de todas as terças
// seguintes. É a mesma razão pela qual a deteção de anomalias usa MAD.
//
// A tendência é a razão entre o passado recente e o anterior, limitada a ±40%: uma
// clínica pode crescer, mas uma tendência sem travão extrapola duas semanas boas para
// o infinito, e uma previsão dessas não é acionável — é ruído com uma seta.
//
// E, sobretudo: é explicável. Quando o gestor perguntar "porquê 4.200€?", a resposta é
// "é o que as últimas cinco terças deram, mais 6% de tendência". Um modelo que não se
// consegue explicar a quem decide não se usa numa clínica.

export interface Observation {
  /** ISO 'YYYY-MM-DD'. */
  date: string;
  value: number;
}

export interface ForecastDay {
  date: string;
  weekday: number;
  value: number;
  /** Banda de confiança, a partir da dispersão histórica do mesmo dia da semana. */
  low: number;
  high: number;
  /** Quantas observações passadas sustentam este dia. Zero = adivinhação. */
  basis: number;
}

export interface ForecastResult {
  days: ForecastDay[];
  total: number;
  totalLow: number;
  totalHigh: number;
  /** Fator de tendência aplicado (1 = estável, 1.06 = +6%). */
  trend: number;
  /** Dias com histórico suficiente, dos que foram pedidos. */
  confidentDays: number;
}

/** Mínimo de observações do mesmo dia da semana para não ser adivinhação. */
export const MIN_BASIS = 3;
/** Travão da tendência: nem colapso nem crescimento infinito. */
export const TREND_CAP = 0.4;

export function median(values: readonly number[]): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

/** Desvio absoluto mediano — dispersão que um outlier não distorce. */
export function mad(values: readonly number[]): number {
  if (!values.length) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

function parseDate(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Agrupa o histórico por dia da semana (0=domingo). Dias sem observação nenhuma não
 * aparecem — uma clínica fechada ao domingo não deve receber previsão para domingo.
 */
export function byWeekday(history: readonly Observation[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const o of history) {
    const d = parseDate(o.date);
    if (!d || !Number.isFinite(o.value)) continue;
    const wd = d.getUTCDay();
    const list = out.get(wd);
    if (list) list.push(o.value);
    else out.set(wd, [o.value]);
  }
  return out;
}

/**
 * Razão entre a metade recente e a metade anterior do histórico, limitada a ±TREND_CAP.
 * Devolve 1 quando não há base para afirmar tendência nenhuma.
 */
export function trendFactor(history: readonly Observation[]): number {
  const ordered = [...history].filter((o) => Number.isFinite(o.value)).sort((a, b) => a.date.localeCompare(b.date));
  // Menos de duas semanas não sustenta uma afirmação sobre tendência.
  if (ordered.length < 14) return 1;

  const half = Math.floor(ordered.length / 2);
  const older = median(ordered.slice(0, half).map((o) => o.value));
  const recent = median(ordered.slice(half).map((o) => o.value));
  // Base zero não dá razão nenhuma: sem denominador, não há tendência a afirmar.
  if (older <= 0) return 1;

  const raw = recent / older;
  return Math.min(1 + TREND_CAP, Math.max(1 - TREND_CAP, raw));
}

/**
 * Prevê os próximos `horizonDays` a partir de `from` (exclusive: começa no dia seguinte).
 *
 * `history` é a série diária observada. Dias em que a clínica não trabalha simplesmente
 * não estão lá, e por isso não recebem previsão — a ausência é informação.
 */
export function forecast(
  history: readonly Observation[],
  horizonDays: number,
  from: Date = new Date(),
): ForecastResult {
  const trend = trendFactor(history);
  const groups = byWeekday(history);
  const days: ForecastDay[] = [];

  for (let i = 1; i <= Math.max(0, horizonDays); i++) {
    const d = addDays(from, i);
    const wd = d.getUTCDay();
    const observed = groups.get(wd) || [];
    if (!observed.length) continue;

    const base = median(observed);
    const spread = mad(observed);
    const value = base * trend;

    days.push({
      date: toIso(d),
      weekday: wd,
      value: round2(value),
      low: round2(Math.max(0, (base - spread) * trend)),
      high: round2((base + spread) * trend),
      basis: observed.length,
    });
  }

  return {
    days,
    total: round2(sum(days.map((d) => d.value))),
    totalLow: round2(sum(days.map((d) => d.low))),
    totalHigh: round2(sum(days.map((d) => d.high))),
    trend: Math.round(trend * 1000) / 1000,
    confidentDays: days.filter((d) => d.basis >= MIN_BASIS).length,
  };
}

/**
 * A previsão é utilizável? Um total bonito construído sobre dois sábados não é previsão,
 * é uma opinião com casas decimais — e a interface deve dizê-lo em vez de o esconder.
 */
export function isReliable(result: ForecastResult): boolean {
  return result.days.length > 0 && result.confidentDays >= Math.ceil(result.days.length * 0.6);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
