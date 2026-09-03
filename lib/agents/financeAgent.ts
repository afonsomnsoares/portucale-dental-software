import { query } from '../db';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { aiActor, replaceOpenInsights } from './insights';

// O agente Finanças. Olha para o dinheiro que já foi faturado: quanto está por cobrar,
// há quanto tempo, e onde é que a receita se está a concentrar ou a perder.
//
// O que este agente NÃO faz, e é preciso dizê-lo porque estava no plano: não gere planos
// de pagamento nem faz reconciliação bancária — nada disso existe no schema (não há
// tabela de prestações nem de movimentos bancários), e um agente não inventa dados que
// a base não tem. Quando essas tabelas existirem, é aqui que entram.
//
// Só lê e conclui: não emite faturas, não marca nada como pago, não contacta ninguém.
const AGENT_ID = 'finance';
const ACTOR = aiActor('Finanças');

const KINDS = ['overdue_balance', 'aging_debt', 'revenue_concentration', 'unbilled_work', 'collection_rate'];

const SYSTEM_PROMPT = `És o agente financeiro de uma clínica dentária. Recebes números JÁ CALCULADOS (em JSON) sobre faturação e cobrança: valor total em dívida, a sua repartição por antiguidade, quantas faturas estão por liquidar, receita do período e trabalho concluído mas ainda não faturado.

Nunca inventes números nem recalcules nada — usa só o que te é dado.

Escreve no máximo 4 conclusões, em português europeu, sobre onde está o dinheiro parado e o que fazer. Cita sempre os valores concretos em euros. Em impactEur põe o valor em euros que está em causa nessa conclusão específica, sempre retirado do JSON.

Usa severity "critical" para dívida antiga em risco real de não ser cobrada, "warning" para valores relevantes por cobrar, "info" para o resto.`;

export async function reviewFinance(tenantId: string) {
  const [balances] = await query(
    `SELECT
       COALESCE(SUM(amount - paid), 0)::numeric AS em_divida,
       COUNT(*) FILTER (WHERE amount > paid)::int AS faturas_por_liquidar,
       COALESCE(SUM(amount - paid) FILTER (WHERE invoice_date < CURRENT_DATE - INTERVAL '90 days'), 0)::numeric AS divida_mais_90d,
       COALESCE(SUM(amount - paid) FILTER (
         WHERE invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND invoice_date < CURRENT_DATE - INTERVAL '30 days'
       ), 0)::numeric AS divida_30_90d,
       COALESCE(SUM(paid) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '30 days'), 0)::numeric AS cobrado_30d,
       COALESCE(SUM(amount) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '30 days'), 0)::numeric AS faturado_30d
     FROM invoices
     WHERE tenant_id = $1`,
    [tenantId],
  );

  // Tratamento concluído sem nenhuma fatura da clínica a cobri-lo — "faturação" no
  // sentido em que faltava: trabalho feito que ainda não virou dinheiro a cobrar.
  const [unbilled] = await query(
    `SELECT COALESCE(SUM(fee), 0)::numeric AS valor, COUNT(*)::int AS n
     FROM treatments t
     WHERE t.tenant_id = $1 AND t.status = 'completed'
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = t.patient_id AND i.amount > 0)`,
    [tenantId],
  );

  const outstanding = Number(balances?.em_divida || 0);
  const unbilledValue = Number(unbilled?.valor || 0);
  if (outstanding <= 0 && unbilledValue <= 0) return { insights: 0, configured: true as const };

  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'financeAgent',
    system: SYSTEM_PROMPT,
    payload: {
      emDividaEur: outstanding,
      faturasPorLiquidar: Number(balances?.faturas_por_liquidar || 0),
      dividaMais90diasEur: Number(balances?.divida_mais_90d || 0),
      divida30a90diasEur: Number(balances?.divida_30_90d || 0),
      faturado30diasEur: Number(balances?.faturado_30d || 0),
      cobrado30diasEur: Number(balances?.cobrado_30d || 0),
      trabalhoConcluidoPorFaturarEur: unbilledValue,
      tratamentosPorFaturar: Number(unbilled?.n || 0),
    },
    tool: {
      name: 'submit_finance_review',
      description: 'Regista as conclusões sobre cobrança e faturação desta clínica.',
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

  // Teto: nenhuma conclusão pode valer mais do que todo o dinheiro que este agente viu.
  const insights = clampInsights(result.input.insights, {
    allowedKinds: KINDS,
    maxImpactEur: outstanding + unbilledValue,
    maxItems: 4,
  });
  if (!insights.length) return { insights: 0, configured: true as const };

  return { ...(await replaceOpenInsights(tenantId, AGENT_ID, insights, ACTOR)), configured: true as const };
}
