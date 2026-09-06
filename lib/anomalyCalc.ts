// Deteção de anomalias — lógica pura, sem DB, testável como lib/forecastCalc.ts.
//
// "A IA deve dizer: isto não é normal." A parte difícil não é detetar — é definir
// *normal*. Aqui normal é o comportamento da própria clínica no seu próprio passado:
// uma ocupação de 62% é excelente numa clínica e um alarme noutra, e um limiar fixo
// para toda a gente dispara em todo o lado ou em lado nenhum.
//
// ─── Porquê MAD e não desvio-padrão ────────────────────────────────────────────
// O desvio-padrão é calculado a partir da média, e ambos são arrastados pelo próprio
// outlier que se procura: uma semana catastrófica alarga o desvio o suficiente para
// se tornar "normal", e a anomalia seguinte já não dispara. A mediana e o desvio
// absoluto mediano não se deixam mover por até metade dos pontos, que é exatamente o
// que se quer de um detetor.
//
// ─── E a causa ─────────────────────────────────────────────────────────────────
// Detetar que "a ocupação caiu 15%" é metade do trabalho e a metade fácil. O que o
// gestor precisa é de saber ONDE caiu. attributeCause() decompõe a variação pelos
// segmentos que a compõem (dentista, cadeira, tratamento, dia da semana) e devolve os
// que mais contribuíram — não o segmento que mais caiu em percentagem, mas o que mais
// pesou na queda absoluta. São coisas diferentes: um dentista que passou de 2 para 1
// consulta caiu 50% e não explica nada.

import type { InsightSeverity } from './agents/insightCalc';
import { mad, median } from './forecastCalc';

/** Abaixo disto a variação é ruído, por muito que o desvio robusto diga o contrário. */
export const MIN_DEVIATION_PCT = 8;
/** Histórico mínimo para afirmar o que é normal. */
export const MIN_HISTORY = 6;

export type AnomalyDirection = 'up' | 'down';

export interface Anomaly {
  direction: AnomalyDirection;
  /** Variação face ao normal, em percentagem (sempre positiva). */
  deviationPct: number;
  /** Quantos desvios absolutos medianos, robusto a outliers. */
  score: number;
  severity: InsightSeverity;
  baseline: number;
  current: number;
}

/**
 * `current` é anormal face a `history`? Devolve null quando é normal, quando o
 * histórico é curto de mais para afirmar seja o que for, ou quando a variação é
 * pequena de mais para valer o alarme.
 *
 * `history` NÃO deve incluir o valor atual — comparar um valor consigo próprio
 * encolhe o desvio e esconde precisamente o que se procura.
 */
export function detectAnomaly(current: number, history: readonly number[]): Anomaly | null {
  const clean = history.filter((n) => Number.isFinite(n));
  if (clean.length < MIN_HISTORY || !Number.isFinite(current)) return null;

  const baseline = median(clean);
  if (baseline === 0) return null;

  const deviationPct = Math.abs((current - baseline) / baseline) * 100;
  if (deviationPct < MIN_DEVIATION_PCT) return null;

  // 1.4826 converte MAD em algo comparável a um desvio-padrão numa distribuição
  // normal — mantém a escala legível ("3 sigma") sem herdar a fragilidade da média.
  const dispersion = mad(clean) * 1.4826;
  // Dispersão nula significa histórico perfeitamente constante: qualquer desvio acima
  // do mínimo é, por construção, anormal.
  const score = dispersion > 0 ? Math.abs(current - baseline) / dispersion : Number.POSITIVE_INFINITY;

  return {
    direction: current > baseline ? 'up' : 'down',
    deviationPct: Math.round(deviationPct * 10) / 10,
    score: Number.isFinite(score) ? Math.round(score * 10) / 10 : 99,
    severity: severityFor(score, deviationPct),
    baseline: Math.round(baseline * 100) / 100,
    current: Math.round(current * 100) / 100,
  };
}

function severityFor(score: number, deviationPct: number): InsightSeverity {
  if (score >= 4 || deviationPct >= 40) return 'critical';
  if (score >= 2.5 || deviationPct >= 20) return 'warning';
  return 'info';
}

export interface Segment {
  label: string;
  value: number;
}

export interface CauseContribution {
  label: string;
  /** Variação absoluta deste segmento (negativa = caiu). */
  delta: number;
  /** Que fatia da variação total este segmento explica, em percentagem. */
  sharePct: number;
  before: number;
  after: number;
}

/**
 * Decompõe uma variação pelos segmentos que a produziram, do que mais pesou para o que
 * menos pesou. Segmentos que se moveram contra a variação (subiram numa queda) são
 * descartados: explicam o contrário do que se procura.
 *
 * Só devolve segmentos até cobrir `coverage` da variação — três causas que explicam 80%
 * dizem mais do que doze que somam 100%.
 */
export function attributeCause(
  before: readonly Segment[],
  after: readonly Segment[],
  { max = 3, coverage = 0.8 }: { max?: number; coverage?: number } = {},
): CauseContribution[] {
  const beforeMap = new Map(before.map((s) => [s.label, s.value]));
  const afterMap = new Map(after.map((s) => [s.label, s.value]));
  const labels = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const deltas = [...labels].map((label) => {
    const b = beforeMap.get(label) ?? 0;
    const a = afterMap.get(label) ?? 0;
    return { label, delta: a - b, before: b, after: a };
  });

  const totalDelta = deltas.reduce((acc, d) => acc + d.delta, 0);
  if (totalDelta === 0) return [];

  const sign = Math.sign(totalDelta);
  const aligned = deltas
    .filter((d) => Math.sign(d.delta) === sign && d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const out: CauseContribution[] = [];
  let explained = 0;
  for (const d of aligned) {
    if (out.length >= max) break;
    const sharePct = Math.round((d.delta / totalDelta) * 1000) / 10;
    out.push({
      label: d.label,
      delta: Math.round(d.delta * 100) / 100,
      sharePct,
      before: Math.round(d.before * 100) / 100,
      after: Math.round(d.after * 100) / 100,
    });
    explained += Math.abs(d.delta / totalDelta);
    if (explained >= coverage) break;
  }
  return out;
}

/** Frase pronta a mostrar: "sobretudo Dr. Silva (58% da queda) e Cadeira 3 (24%)." */
export function describeCause(causes: readonly CauseContribution[]): string {
  if (!causes.length) return '';
  const parts = causes.map((c) => `${c.label} (${Math.abs(c.sharePct)}%)`);
  const head = parts.slice(0, -1).join(', ');
  const tail = parts[parts.length - 1];
  return parts.length === 1 ? `sobretudo ${tail}` : `sobretudo ${head} e ${tail}`;
}
