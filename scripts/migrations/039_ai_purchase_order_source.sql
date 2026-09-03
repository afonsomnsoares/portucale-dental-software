-- ─── source='ai' em purchase_orders ────────────────────────────────────────────
-- lib/agents/reorderAgent.ts (o agente Operações, primeiro agente com IA realmente
-- ligada — ver lib/agents/registry.ts) passa a poder criar/atualizar o rascunho de
-- reposição sozinho, sem fila de aprovação prévia: decide que itens e quantidades
-- encomendar a partir do mesmo forecast que já alimentava a versão determinística
-- (generateReorderSuggestions em lib/inventory.ts, que continua a existir como
-- fallback quando ANTHROPIC_API_KEY não está definida ou a chamada falha).
--
-- O 'source' original só distinguia 'auto' (regra fixa) de 'manual' (pessoa a
-- criar a encomenda à mão). Precisa de um terceiro valor para a origem IA ficar
-- visível na UI e no audit_log em vez de se disfarçar de 'auto' — a fronteira de
-- segurança real não está aqui (está em nunca sair de 'draft' sem uma pessoa: ver
-- app/api/purchase-orders/[id]/route.ts), mas a proveniência tem de ser honesta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'purchase_orders'::regclass AND conname = 'purchase_orders_source_check'
  ) THEN
    ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_source_check;
  END IF;
  ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_source_check
    CHECK (source IN ('auto', 'manual', 'ai'));
END $$;
