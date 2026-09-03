import { computeClinicComparison } from '../reports';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { aiActor, replaceOpenInsights } from './insights';

// O agente Grupo. É o único de todos que não pertence a nenhuma clínica: compara-as
// entre si, e por isso escreve insights com tenant_id NULL — que só o super-admin vê
// (ver a política de RLS da migração 041). Uma clínica nunca lê o que este agente
// escreve sobre as outras.
//
// Também é o único que não corre dentro do runJob() por clínica: corre uma vez por
// passagem do cron, sobre todas de uma vez (ver runGroupAgent em scripts/run-jobs.ts).
// Correr por clínica seria pedir N vezes a mesma comparação e escrever N cópias.
//
// A comparação em si (receita, conversão, faltas, ocupação por clínica, e o "gap" em
// euros entre a melhor e a pior) já era calculada por lib/reports.ts para o ecrã de
// comparação do super-admin. O que a IA acrescenta é a leitura: onde é que a diferença
// entre unidades é estrutural e vale a pena agir, e não apenas ruído de um mês.
const AGENT_ID = 'group';
const ACTOR = aiActor('Grupo');
const WINDOW_DAYS = 30;
// Abaixo de duas clínicas não há grupo nenhum para comparar.
const MIN_CLINICS = 2;

const KINDS = ['benchmark_gap', 'capacity_imbalance', 'outlier_clinic', 'group_trend'];

const SYSTEM_PROMPT = `És o agente de grupo de uma rede de clínicas dentárias. Recebes métricas JÁ CALCULADAS (em JSON) de cada clínica do grupo no mesmo período de 30 dias — receita, valor de planos apresentados e aceites, taxa de conversão, taxa de faltas e ocupação de cadeira — mais o "gap" em euros já apurado entre a clínica com melhor e pior conversão.

Nunca inventes números, clínicas ou métricas, e nunca recalcules nada — usa só o que te é dado.

Escreve no máximo 4 conclusões, em português europeu, para quem gere a rede. Identifica onde a diferença entre unidades é grande o suficiente para justificar ação (levar a prática de uma clínica a outra, redistribuir capacidade), nomeia as clínicas concretas, e cita os números. Em impactEur usa o valor em euros que o JSON já traz para essa diferença.

Usa severity "critical" para uma unidade claramente fora da curva, "warning" para diferenças relevantes, "info" para o resto.`;

export async function reviewGroup() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const comparison = await computeClinicComparison(from, to);
  if (comparison.clinics.length < MIN_CLINICS) return { insights: 0, configured: true as const };

  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'groupAgent',
    system: SYSTEM_PROMPT,
    payload: {
      periodo: comparison.range,
      clinicas: comparison.clinics.map((c) => ({
        nome: c.name,
        receitaEur: c.revenue,
        planosApresentadosEur: c.presentedValue,
        planosAceitesEur: c.acceptedValue,
        taxaConversaoPct: c.conversionRate,
        taxaFaltasPct: c.noShowRate,
        ocupacaoPct: c.chairUtilization,
      })),
      diferencaConversaoEur: comparison.gap?.valueDiff ?? null,
    },
    tool: {
      name: 'submit_group_review',
      description: 'Regista as conclusões de comparação entre as clínicas do grupo.',
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

  // Teto: a receita somada de todo o grupo no período. Uma diferença entre clínicas não
  // pode valer mais do que tudo o que o grupo faturou.
  const maxImpact = comparison.clinics.reduce((sum, c) => sum + Number(c.revenue || 0), 0);
  const insights = clampInsights(result.input.insights, {
    allowedKinds: KINDS,
    maxImpactEur: maxImpact,
    maxItems: 4,
  });
  if (!insights.length) return { insights: 0, configured: true as const };

  // tenant_id NULL: insight de plataforma, não de nenhuma clínica.
  return { ...(await replaceOpenInsights(null, AGENT_ID, insights, ACTOR)), configured: true as const };
}
