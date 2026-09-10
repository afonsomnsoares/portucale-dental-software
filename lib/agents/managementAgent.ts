import { computeClinicSummary } from '../reports';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { aiActor, replaceOpenInsights } from './insights';

// O agente Gestão. É o único que não tem um domínio próprio: não olha para a agenda, nem
// para o dinheiro, nem para os doentes em separado — olha para o período fechado contra o
// período anterior e responde a uma pergunta só: o que mudou, porquê, e quanto custa.
//
// A comparação entre períodos já era calculada por lib/reports.ts (é o que alimenta
// app/api/reports/insight/route.ts, o primeiro ponto de IA que este projeto teve). A
// diferença é que aquele só responde quando alguém carrega num botão e devolve um
// parágrafo solto; este corre sozinho, guarda o que encontra, e atribui um valor em
// euros à perda quando os números o sustentam.
//
// Não age: "sugere ou executa ações" era o plano, e ficou-se pelo sugerir. Executar
// aqui significaria mexer na agenda, no dinheiro ou nos doentes de outra pessoa — cada
// um desses tem o seu agente, com as suas fronteiras, e é lá que a ação pertence.
const AGENT_ID = 'management';
const ACTOR = aiActor('Gestão');
const WINDOW_DAYS = 30;

const KINDS = ['revenue_drop', 'conversion_drop', 'no_show_spike', 'occupancy_drop', 'acquisition_drop', 'positive'];

const SYSTEM_PROMPT = `És o analista de gestão de uma clínica dentária. Recebes métricas JÁ CALCULADAS (em JSON) de um período de 30 dias e a variação face ao período anterior: receita, ocupação de cadeira, taxa de faltas, novos doentes, valor de planos apresentados e aceites, taxa de conversão, receita potencial perdida e saldo em dívida.

Nunca inventes números nem recalcules nada — usa só o que te é dado.

Escreve no máximo 4 conclusões, em português europeu, para quem gere a clínica. Cada uma tem de: (1) identificar o desvio concreto, (2) explicar a causa mais provável à luz dos outros números, e (3) quantificar a perda em euros em impactEur quando os dados o sustentam. Cita sempre os números.

Se o período correu bem, diz isso com kind "positive" em vez de inventar um problema — não escrevas conclusões negativas sem dados que as sustentem.

Usa severity "critical" para uma quebra que ameaça o negócio, "warning" para um desvio relevante, "info" para variações pequenas ou boas notícias.`;

export async function reviewManagement(tenantId: string) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const summary = await computeClinicSummary(tenantId, from, to);
  if (!summary) return { insights: 0, configured: true as const };

  const m = summary.metrics;
  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'managementAgent',
    tenantId,
    system: SYSTEM_PROMPT,
    payload: {
      periodo: summary.range,
      receitaEur: m.completedValue,
      tendenciaReceitaPct: summary.previous.revenueTrend,
      ocupacaoPct: m.chairUtilization,
      taxaFaltasPct: m.noShowRate,
      tendenciaFaltasPct: summary.previous.noShowTrend,
      novosDoentes: m.newPatients,
      planosApresentadosEur: m.presentedValue,
      planosAceitesEur: m.acceptedValue,
      taxaConversaoPct: m.planConversionRate,
      tendenciaConversaoPct: summary.previous.conversionTrend,
      receitaPotencialPerdidaEur: m.recoveryPotential,
      saldoEmDividaEur: m.outstandingBalance,
    },
    tool: {
      name: 'submit_management_review',
      description: 'Regista os desvios do período, a causa provável e a perda quantificada.',
      input_schema: {
        type: 'object',
        properties: {
          insights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: KINDS },
                severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                title: { type: 'string' },
                body: { type: 'string' },
                impactEur: { type: 'number' },
              },
              required: ['kind', 'severity', 'title', 'body'],
            },
          },
        },
        required: ['insights'],
      },
    },
  });

  if (result.status === 'unconfigured') return { insights: 0, configured: false as const };
  if (result.status === 'failed') return { insights: 0, configured: true as const };

  // Teto da perda: nada pode "custar" mais do que a receita do período mais o que já
  // estava identificado como potencial perdido e em dívida. Sem este limite, "a quebra
  // custou-te 2 milhões" passava tal e qual para o ecrã do gestor.
  const maxImpact =
    Number(m.completedValue || 0) + Number(m.recoveryPotential || 0) + Number(m.outstandingBalance || 0);
  const insights = clampInsights(result.input.insights, {
    allowedKinds: KINDS,
    maxImpactEur: maxImpact,
    maxItems: 4,
  });
  if (!insights.length) return { insights: 0, configured: true as const };

  // Só substitui os tipos que este agente escreve: as anomalias de lib/anomaly.ts vivem
  // sob o mesmo agente e não podem ser apagadas por esta corrida.
  return {
    ...(await replaceOpenInsights(tenantId, AGENT_ID, insights, ACTOR, { kinds: KINDS })),
    configured: true as const,
  };
}
