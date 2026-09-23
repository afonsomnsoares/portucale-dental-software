-- ─── Artigos de inventário próprios de uma clínica ──────────────────────────────
-- `inventory_items` era global por inteiro (migração 044): o catálogo partilhado, sem
-- tenant_id e por isso fora da RLS. O PUT /api/inventory/items/[id] já tinha sido
-- fechado para que só a plataforma mexesse nele — mas o POST ficou de fora, e um admin
-- de clínica (que tem `inventory:manage` por omissão) criava artigos no catálogo de
-- TODAS as clínicas. O botão «+ Novo item» do ecrã de inventário fazia isso mesmo.
--
-- Fechar o POST à clínica partia o caso que o botão existe para servir: uma clínica
-- que trabalha com um produto que o catálogo não tem. Por isso o modelo é o da migração
-- 035 (treatment_codes, statuses):
--
--   tenant_id IS NULL      → artigo do catálogo global, visível a todos, só a
--                            plataforma o escreve
--   tenant_id = <clínica>  → artigo próprio dessa clínica, invisível às outras
--
-- As linhas que já existem ficam a NULL, ou seja, continuam globais. Um artigo que uma
-- clínica tenha criado antes desta migração não se consegue distinguir de um criado
-- pela plataforma — o INSERT não guardava quem o fez —, por isso não se tenta adivinhar.
--
-- A política é a mesma da 035 e chama-se `tenant_isolation`, para cair na view
-- `tenant_tables_without_rls` e no test/integration/rls-enforcement.test.ts sem
-- ninguém se lembrar de a inscrever.
--
-- ─── A RLS não chega sozinha ────────────────────────────────────────────────────
-- O serviço `jobs` liga-se como administrador e passa ao lado da RLS. As leituras do
-- catálogo em lib/inventory.ts e lib/costing.ts correm lá dentro, clínica a clínica;
-- sem filtro explícito, o artigo próprio de uma clínica aparecia na previsão e nas
-- sugestões de encomenda das outras. Essas consultas filtram por
-- `(tenant_id IS NULL OR tenant_id = $1)` na mesma alteração.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory_items(tenant_id);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='inventory_items' AND policyname='tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory_items
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id IS NULL
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
