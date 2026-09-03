import Anthropic from '@anthropic-ai/sdk';
import { appendAudit } from '../audit';
import type { SessionUser } from '../auth';
import { withTransaction } from '../db';
import { computeInventoryOverview, generateReorderSuggestions } from '../inventory';
import { clampAiReorderDecision, type ReorderCandidate } from './reorderAgentCalc';

// O agente Operações, primeiro (e por agora único) dos seis de lib/agents/registry.ts com
// IA realmente ligada (ai: 'wired') em vez de 'none'. Age de forma autónoma sobre a tarefa
// 'reorderSuggestions' — decide sozinho o que repor e escreve o rascunho de encomenda, sem
// fila de aprovação prévia — mas o raio de ação está contido por desenho, não por confiança
// no modelo:
//   1. Só pode escolher itens da lista de candidatos já em risco (nunca inventa um item).
//   2. Só pode pedir até 2x a quantidade que a regra determinística já sugeria (ver
//      reorderAgentCalc.ts) — nunca uma encomenda descontrolada por alucinação.
//   3. O resultado fica sempre em purchase_orders.status='draft'. Sair daí para 'ordered'
//      continua a exigir uma pessoa (app/api/purchase-orders/[id]/route.ts) — a IA nunca
//      contacta um fornecedor nem gasta dinheiro sozinha.
//   4. Sem ANTHROPIC_API_KEY, ou se a chamada falhar por qualquer razão, cai para
//      generateReorderSuggestions() (a regra fixa de sempre) em vez de deixar a clínica
//      sem sugestão nenhuma — o job nunca falha por a IA estar em baixo.
//
// Usado quem/o quê aparece no audit_log como ator: SYSTEM_ACTOR (lib/jobsRunner.ts) é "algo
// correu sem pessoa por trás"; AI_ACTOR é mais específico — "o modelo decidiu isto", para
// quem revê o audit_log conseguir distinguir das outras tarefas puramente determinísticas.
export const AI_ACTOR: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = {
  id: '',
  name: 'Agente IA — Operações',
  role: 'system',
  clinic: 'System',
};

const MODEL = 'claude-sonnet-5';
// Nunca vale a pena mandar a lista toda para o modelo se for enorme — não é limite de
// segurança (o espaço de candidatos já limita o que a IA pode escolher), é só custo: uma
// clínica com centenas de itens em risco ao mesmo tempo tem um problema de stock maior do
// que o agente resolve numa chamada, e a run seguinte apanha o resto.
const MAX_CANDIDATES = 40;

const SYSTEM_PROMPT = `És o agente de reposição de stock de uma clínica dentária. Recebes uma lista de itens já identificados como em risco de rutura (em JSON), com a quantidade que uma regra fixa já sugeria — nunca inventes itens fora desta lista nem recalcules o risco, ele já está apurado.

A tua função é ajustar, não substituir: para cada item, decide a quantidade final a incluir no rascunho de encomenda (podes seguir a sugestão, reduzi-la, ou aumentá-la até ao dobro — nunca mais), com base em days_until_stockout (urgência) e nos lotes com validade próxima (batches) que já cobrem parte da procura. Podes omitir um item se concluíres que não precisa de reposição agora. Explica em duas frases, em português europeu, o raciocínio geral por trás das escolhas.

O resultado é sempre um rascunho revisto por uma pessoa antes de seguir para o fornecedor — nunca encomendas nem gastas dinheiro diretamente.`;

const TOOL_NAME = 'propose_reorder';

function buildPayload(candidates: ReorderCandidate[], overviewById: Map<number, unknown>) {
  return candidates.map((c) => ({
    itemId: c.itemId,
    item: c.itemName,
    suggestedReorderQty: c.suggestedReorderQty,
    ...(overviewById.get(c.itemId) as Record<string, unknown> | undefined),
  }));
}

async function writeDraftOrder(
  tenantId: string,
  items: Array<{ itemId: number; quantity: number; reason: string }>,
  summary: string,
) {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      `SELECT id FROM purchase_orders WHERE tenant_id=$1 AND status='draft' AND source IN ('auto','ai')
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    let poId: string = existing[0]?.id;
    if (!poId) {
      const { rows } = await client.query(
        `INSERT INTO purchase_orders (tenant_id, status, source, notes)
         VALUES ($1,'draft','ai',$2)
         RETURNING id`,
        [tenantId, summary.slice(0, 2000) || 'Sugestão do agente de Operações'],
      );
      poId = rows[0].id;
    } else {
      await client.query(`UPDATE purchase_orders SET source='ai', notes=$2, updated_at=NOW() WHERE id=$1`, [
        poId,
        summary.slice(0, 2000) || 'Sugestão do agente de Operações',
      ]);
    }
    for (const it of items) {
      await client.query(
        `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, item_id, quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (purchase_order_id, item_id) DO UPDATE SET quantity=EXCLUDED.quantity`,
        [tenantId, poId, it.itemId, it.quantity],
      );
    }
    return { suggested: items.length, purchaseOrderId: poId, source: 'ai' as const };
  });
}

export async function generateReorderSuggestionsAI(tenantId: string) {
  const overview = await computeInventoryOverview(tenantId);
  const atRisk = overview.filter((o) => o.atRisk && o.suggestedReorderQty > 0);
  if (!atRisk.length) return { suggested: 0, purchaseOrderId: null, source: 'none' as const };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ...(await generateReorderSuggestions(tenantId)), source: 'auto' as const };
  }

  const candidates: ReorderCandidate[] = atRisk
    .slice(0, MAX_CANDIDATES)
    .map((o) => ({ itemId: o.item.id, itemName: o.item.item, suggestedReorderQty: o.suggestedReorderQty }));
  const overviewById = new Map(
    atRisk.map((o) => [
      o.item.id,
      {
        unit: o.item.unit,
        currentQty: o.currentQty,
        daysUntilStockout: o.daysUntilStockout,
        batches: o.batches.map((b) => ({ quantity: b.quantity, expiryStatus: b.expiryStatus })),
      },
    ]),
  );

  let items: ReturnType<typeof clampAiReorderDecision> = [];
  let summary = '';
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(buildPayload(candidates, overviewById)) }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Regista a decisão de reposição para esta corrida do agente.',
          input_schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    itemId: { type: 'integer' },
                    quantity: { type: 'integer', minimum: 1 },
                    reason: { type: 'string' },
                  },
                  required: ['itemId', 'quantity'],
                },
              },
              summary: { type: 'string' },
            },
            required: ['items', 'summary'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    const input = (toolUse?.input || {}) as { items?: unknown[]; summary?: unknown };
    items = clampAiReorderDecision(candidates, (input.items || []) as never);
    summary = typeof input.summary === 'string' ? input.summary : '';
  } catch (e) {
    // Nunca reenviar a mensagem crua do SDK para fora deste processo — só para o log
    // do servidor. Mesmo princípio de lib/agents/aiClient.ts.
    console.error(
      'reorderAgent: Anthropic call failed, a cair para a regra determinística:',
      e instanceof Error ? e.message : e,
    );
  }

  // A IA não respondeu nada aproveitável (chamada falhou, tool_use vazio, tudo fora do
  // espaço de candidatos) — a clínica não pode ficar sem sugestão só porque o modelo
  // falhou; a regra fixa de sempre continua a valer.
  if (!items.length) {
    return { ...(await generateReorderSuggestions(tenantId)), source: 'auto' as const };
  }

  const result = await writeDraftOrder(tenantId, items, summary);
  await appendAudit(
    AI_ACTOR,
    'CREATE',
    `Reposição sugerida por IA: ${items.length} ${items.length === 1 ? 'item' : 'itens'}`,
    null,
    summary || null,
    AI_ACTOR.clinic,
  );
  return result;
}
