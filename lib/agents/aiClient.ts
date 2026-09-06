import Anthropic from '@anthropic-ai/sdk';

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

export async function callAgentTool<T>({
  agent,
  system,
  payload,
  tool,
  maxTokens = 2048,
}: {
  /** Só para o log: qual dos agentes é que falhou. */
  agent: string;
  system: string;
  /** Os factos já apurados. Serializado para JSON — o modelo nunca recalcula nada. */
  payload: unknown;
  tool: AgentToolSpec;
  maxTokens?: number;
}): Promise<AgentToolResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 'unconfigured' };

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
    if (!toolUse) {
      console.error(`${agent}: resposta da IA sem bloco tool_use '${tool.name}'`);
      return { status: 'failed' };
    }
    return { status: 'ok', input: (toolUse.input || {}) as T };
  } catch (e) {
    console.error(`${agent}: chamada à Anthropic falhou:`, e instanceof Error ? e.message : e);
    return { status: 'failed' };
  }
}
