// Lógica pura partilhada pelos agentes de análise (Agenda, Finanças, Gestão, Grupo) —
// sem DB, sem IA, testável como lib/agents/reorderAgentCalc.ts.
//
// Todos eles pedem à IA a mesma forma de resposta: uma lista de conclusões com título,
// explicação, gravidade e, quando é dinheiro, um valor. O que muda entre agentes é o
// prompt e os factos que recebem — não a validação, que é esta.
//
// O limite que interessa aqui é o `impactEur`: a IA recebe números já calculados e é
// instruída a citá-los, mas nada a impede de escrever "isto custa-te 4 milhões". Cada
// agente passa o máximo plausível (tipicamente a soma dos valores que ele próprio
// apurou); acima disso o valor é descartado — fica o texto, cai o número inventado.

const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type InsightSeverity = (typeof SEVERITIES)[number];

export interface AiInsight {
  kind?: unknown;
  severity?: unknown;
  title?: unknown;
  body?: unknown;
  impactEur?: unknown;
}

export interface ClampedInsight {
  kind: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  impactEur: number | null;
}

export function clampInsights(
  aiItems: readonly AiInsight[] | null | undefined,
  {
    allowedKinds,
    maxImpactEur,
    maxItems = 10,
  }: { allowedKinds: readonly string[]; maxImpactEur: number; maxItems?: number },
): ClampedInsight[] {
  const kinds = new Set(allowedKinds);
  const out: ClampedInsight[] = [];

  for (const raw of aiItems || []) {
    if (out.length >= maxItems) break;

    const kind = String(raw.kind || '');
    // O tipo de conclusão vem de uma lista fechada por agente: a IA classifica dentro
    // do que o produto sabe mostrar, não inventa categorias novas a cada corrida.
    if (!kinds.has(kind)) continue;

    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 160) : '';
    if (!title) continue;

    const severity = SEVERITIES.includes(raw.severity as InsightSeverity) ? (raw.severity as InsightSeverity) : 'info';
    const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, 1200) : '';

    let impactEur: number | null = null;
    const rawImpact = Number(raw.impactEur);
    if (Number.isFinite(rawImpact) && rawImpact > 0 && rawImpact <= maxImpactEur) {
      impactEur = Math.round(rawImpact * 100) / 100;
    }

    out.push({ kind, severity, title, body, impactEur });
  }

  return out;
}
