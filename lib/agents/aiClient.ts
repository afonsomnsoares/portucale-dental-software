import Anthropic from '@anthropic-ai/sdk';
import { query, warnSchemaGap } from '../db';

// O preâmbulo que os agentes de lib/agents/*Agent.ts repetiam todos: ver se há chave,
// abrir o cliente, forçar uma tool call, extrair o bloco e não deixar um erro do SDK
// rebentar a pipeline de jobs. Mesma razão de existir do lib/route.ts para as rotas —
// o que interessa não é poupar linhas, é a omissão deixar de ser silenciosa: um agente
// novo não pode "esquecer-se" de tratar a chave em falta ou de apanhar o erro.
//
// O resultado é deliberadamente um discriminated union em vez de `T | null`, porque os
// agentes precisam de distinguir os dois casos:
//   'unconfigured' — não há ANTHROPIC_API_KEY. Não é falha: é o produto a correr sem IA,
//                    e cada agente decide o que fazer (cair para a regra fixa, ou não
//                    fazer nada). Ver reorderAgent.ts vs leadAgent.ts, que decidem
//                    diferente precisamente por isto.
//   'failed'       — havia chave e a chamada correu mal. O detalhe fica no log do
//                    servidor, nunca é devolvido a quem chamou (mesmo princípio de
//                    app/api/reports/insight/route.ts).
export type AgentToolResult<T> = { status: 'unconfigured' } | { status: 'failed' } | { status: 'ok'; input: T };

// Sonnet e não Opus: estas chamadas correm em background, uma por clínica por passagem
// do cron (ver scripts/run-jobs.ts), e são decisões estruturadas e limitadas — não
// análise aberta. O custo por corrida importa mais aqui do que na análise a pedido de
// app/api/reports/insight/route.ts, que corre quando alguém carrega num botão.
export const AGENT_MODEL = 'claude-sonnet-5';

export interface AgentToolSpec {
  name: string;
  description: string;
  // O JSON Schema da tool. Tipado como o SDK o quer, sem inventar um tipo próprio.
  input_schema: Anthropic.Tool['input_schema'];
}

// ─── Contabilidade da IA ────────────────────────────────────────────────────
// A resposta da Anthropic traz sempre `usage`, e até à migração 053 esse número era
// lido pelo SDK e deitado fora — a plataforma não sabia dizer quanto custava a IA nem
// que clínica a consumia. Regista-se aqui, no ponto por onde TODOS os agentes passam,
// para nenhum agente novo se poder esquecer (a mesma razão de esta função existir).
//
// Nunca deixa rebentar a chamada que está a medir: se a tabela ainda não existe (base
// de dados por migrar) ou a escrita falha, avisa uma vez e segue. Observabilidade que
// derruba o que observa é pior do que observabilidade nenhuma.
// Exportada porque deixou de haver um só caminho até à Anthropic. `callAgentTool`
// abaixo cobre os agentes, mas app/api/reports/insight/route.ts chama a API
// diretamente — precisa de texto livre, e callAgentTool força uma tool. Enquanto isto
// foi privado, essa rota não registava nada: o painel de plataforma que existe para
// responder a «que clínica está a consumir» omitia por completo o modelo mais caro em
// uso, e apresentava a diferença como se fosse consumo a menos.
async function recordAiCall(row: {
  tenantId: string | null;
  agent: string;
  model: string;
  status: 'ok' | 'failed' | 'unconfigured';
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  error?: string;
}) {
  try {
    await query(
      `INSERT INTO ai_calls (tenant_id, agent, model, status, input_tokens, output_tokens, duration_ms, error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.tenantId,
        row.agent,
        row.model,
        row.status,
        row.inputTokens || 0,
        row.outputTokens || 0,
        row.durationMs ?? null,
        row.error?.slice(0, 500) ?? null,
      ],
    );
  } catch (e) {
    warnSchemaGap('ai_calls', e);
  }
}

export async function callAgentTool<T>({
  agent,
  tenantId = null,
  system,
  payload,
  tool,
  maxTokens = 2048,
}: {
  /** Só para o log: qual dos agentes é que falhou. */
  agent: string;
  /** A clínica que paga esta chamada. NULL para agentes de plataforma (Grupo). */
  tenantId?: string | null;
  system: string;
  /** Os factos já apurados. Serializado para JSON — o modelo nunca recalcula nada. */
  payload: unknown;
  tool: AgentToolSpec;
  maxTokens?: number;
}): Promise<AgentToolResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Registado, não silenciado: saber que uma clínica corre sem IA é informação de
    // plataforma — é a diferença entre "o agente não encontrou nada" e "o agente
    // nunca foi chamado".
    await recordAiCall({ tenantId, agent, model: AGENT_MODEL, status: 'unconfigured' });
    return { status: 'unconfigured' };
  }

  const startedAt = Date.now();
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      tools: [tool],
      // Forçar a tool garante saída estruturada: sem isto o modelo pode responder em
      // texto livre e o agente fica sem nada de que possa validar.
      tool_choice: { type: 'tool', name: tool.name },
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    );
    // Os tokens contam-se mesmo quando a resposta não serve: foram gastos na mesma.
    const usage = {
      tenantId,
      agent,
      model: AGENT_MODEL,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      durationMs: Date.now() - startedAt,
    };

    if (!toolUse) {
      console.error(`${agent}: resposta da IA sem bloco tool_use '${tool.name}'`);
      await recordAiCall({ ...usage, status: 'failed', error: `sem bloco tool_use '${tool.name}'` });
      return { status: 'failed' };
    }
    await recordAiCall({ ...usage, status: 'ok' });
    return { status: 'ok', input: (toolUse.input || {}) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${agent}: chamada à Anthropic falhou:`, message);
    await recordAiCall({
      tenantId,
      agent,
      model: AGENT_MODEL,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return { status: 'failed' };
  }
}
