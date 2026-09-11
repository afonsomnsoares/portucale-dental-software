import { AGENT_MODEL } from './agents/aiClient';
import { queryRead, warnSchemaGap } from './db';
import type { AiUsage, AiUsageRow } from './types/platform';

// Preço por milhão de tokens do modelo dos agentes. Vive aqui e não na base de dados
// porque é um facto externo (tabela de preços da Anthropic), não estado da aplicação —
// e porque um número destes escondido numa tabela é um número que ninguém revê.
//
// É uma ESTIMATIVA e a UI diz isso: o custo faturado real inclui caching de prompts e
// descontos de volume que esta aplicação não vê. Serve para responder a "que clínica é
// que está a consumir" e "a tendência é para subir", que é para o que se olha aqui.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
};

/**
 * O consumo da camada de agentes, por clínica, por agente, por dia e por modelo.
 *
 * Vivia dentro de app/api/platform/ai-usage/route.ts. Saiu de lá quando os
 * painéis de custos e de modelos passaram a lê-lo no servidor: passou a haver
 * dois caminhos até aos mesmos números, e o preço por milhão de tokens não pode
 * estar escrito em dois sítios.
 */
export async function aiUsage(daysParam?: unknown): Promise<AiUsage> {
  const days = Math.min(365, Math.max(1, Number(daysParam ?? 30)));

  const safe = async (scope: string, sql: string, params: unknown[] = []) => {
    try {
      return await queryRead(sql, params);
    } catch (e) {
      warnSchemaGap(scope, e);
      return [];
    }
  };

  const [byTenant, byAgent, byDay, byModel] = await Promise.all([
    safe(
      'ai-usage.tenant',
      `SELECT c.tenant_id, t.name AS tenant_name, t.city AS tenant_city,
              COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE c.status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE c.status = 'unconfigured')::int AS unconfigured,
              COALESCE(SUM(c.input_tokens),0)::bigint AS input_tokens,
              COALESCE(SUM(c.output_tokens),0)::bigint AS output_tokens
         FROM ai_calls c LEFT JOIN tenants t ON t.id = c.tenant_id
        WHERE c.created_at > NOW() - ($1 || ' days')::interval
        GROUP BY c.tenant_id, t.name, t.city
        ORDER BY 7 DESC`,
      [days],
    ),
    safe(
      'ai-usage.agent',
      `SELECT agent, model, COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
              ROUND(AVG(duration_ms))::int AS avg_ms
         FROM ai_calls
        WHERE created_at > NOW() - ($1 || ' days')::interval
        GROUP BY agent, model ORDER BY 3 DESC`,
      [days],
    ),
    safe(
      'ai-usage.day',
      `SELECT DATE(created_at) AS day, COUNT(*)::int AS calls,
              COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
         FROM ai_calls
        WHERE created_at > NOW() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      [days],
    ),
    safe(
      'ai-usage.model',
      `SELECT model, COUNT(*)::int AS calls, MAX(created_at) AS last_at
         FROM ai_calls GROUP BY model ORDER BY 2 DESC`,
    ),
  ]);

  const cost = (input: number, output: number, model = AGENT_MODEL) => {
    const p = PRICE_PER_MTOK[model];
    if (!p) return null;
    return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
  };

  return {
    days,
    // O modelo que o código usa hoje, venha ou não a haver linhas em ai_calls.
    configuredModel: AGENT_MODEL,
    pricePerMTok: PRICE_PER_MTOK,
    byTenant: (byTenant as unknown as AiUsageRow[]).map((r) => ({
      ...r,
      costEur: cost(Number(r.input_tokens), Number(r.output_tokens)),
    })),
    byAgent: (byAgent as unknown as AiUsageRow[]).map((r) => ({
      ...r,
      costEur: cost(Number(r.input_tokens), Number(r.output_tokens), r.model),
    })),
    byDay: (byDay as unknown as AiUsage['byDay']).map((r) => ({
      ...r,
      costEur: cost(Number(r.input_tokens), Number(r.output_tokens)),
    })),
    byModel: byModel as unknown as AiUsage['byModel'],
  };
}
