// Lógica pura do agente Operações para reposição de stock — sem DB, sem chamada à IA,
// testável como lib/inventoryCalc.ts. lib/agents/reorderAgent.ts chama a IA e passa a
// resposta por aqui antes de escrever fosse o que fosse na base de dados.
//
// A IA decide de um espaço de ações deliberadamente pequeno: só pode escolher itens que
// já estavam na lista de candidatos (nunca inventar um item novo) e só pode pedir até ao
// dobro da quantidade que a regra determinística já sugeria (nunca disparar uma encomenda
// descontrolada por uma alucinação de quantidade). Um item omitido pela IA é uma decisão
// dela — "não preciso de repor isto agora" — não um erro a corrigir.

export interface ReorderCandidate {
  itemId: number;
  itemName: string;
  suggestedReorderQty: number;
}

export interface AiReorderItem {
  itemId: unknown;
  quantity: unknown;
  reason?: unknown;
}

export interface ClampedReorderItem {
  itemId: number;
  quantity: number;
  reason: string;
}

// Quantas vezes a sugestão determinística a IA pode, no máximo, propor pedir a mais.
// Conservador de propósito: o objetivo é deixar a IA ajustar dentro da margem, não
// substituir o julgamento dela pelo da regra fixa.
const MAX_MULTIPLIER = 2;

export function clampAiReorderDecision(
  candidates: readonly ReorderCandidate[],
  aiItems: readonly AiReorderItem[] | null | undefined,
): ClampedReorderItem[] {
  const byId = new Map(candidates.map((c) => [c.itemId, c]));
  const seen = new Set<number>();
  const out: ClampedReorderItem[] = [];

  for (const raw of aiItems || []) {
    const itemId = Number(raw.itemId);
    if (!Number.isInteger(itemId) || seen.has(itemId)) continue;
    const candidate = byId.get(itemId);
    if (!candidate) continue; // fora do espaço de candidatos — ignorado, não é erro fatal

    const requested = Number(raw.quantity);
    if (!Number.isFinite(requested)) continue;
    const cap = Math.max(1, Math.round(candidate.suggestedReorderQty * MAX_MULTIPLIER));
    const quantity = Math.round(Math.min(Math.max(requested, 0), cap));
    if (quantity <= 0) continue;

    seen.add(itemId);
    const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '';
    out.push({ itemId, quantity, reason });
  }

  return out;
}
