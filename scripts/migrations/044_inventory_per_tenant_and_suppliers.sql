-- ─── Inventário: definições por clínica e fornecedores ──────────────────────────
-- Duas falhas que só aparecem quando se olha para o inventário como produto
-- multi-clínica, e não como o inventário de uma clínica só:
--
-- 1. `inventory_items` não tem tenant_id: o catálogo é partilhado — o que é uma boa
--    decisão, ninguém quer manter a mesma lista de luvas em vinte clínicas. Mas o
--    `reorder_at` viajava com ele, e isso já não presta: uma clínica com três cadeiras
--    e outra com doze não repõem no mesmo ponto. Alterar o limiar numa mexia em todas.
--
-- 2. Não havia fornecedores. Uma encomenda (purchase_orders) não sabia a quem ia ser
--    feita — o que faz dela uma lista de compras, não uma encomenda.
--
-- O modelo do ponto 1 é o mesmo que a migração 035 usou para treatment_codes e
-- statuses: o catálogo global mantém-se, e cada clínica sobrepõe só o que quer mudar.
-- Aqui como tabela à parte em vez de coluna, porque o que a clínica sobrepõe não é o
-- item (o produto é o mesmo) — é a política de reposição dela sobre esse item.

CREATE TABLE IF NOT EXISTS inventory_item_settings (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  -- NULL = segue o valor do catálogo global.
  reorder_at NUMERIC CHECK (reorder_at IS NULL OR reorder_at >= 0),
  -- FALSE = esta clínica não trabalha com este item; desaparece das listas e da
  -- previsão dela sem sair do catálogo das outras.
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, item_id)
);

ALTER TABLE inventory_item_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='inventory_item_settings' AND policyname='tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory_item_settings
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Fornecedores ───────────────────────────────────────────────────────────────
-- Por clínica, ao contrário do catálogo de itens: o produto é o mesmo em todo o lado,
-- mas cada clínica compra a quem quer, ao seu preço e com o seu contacto.
CREATE TABLE IF NOT EXISTS suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  notes      TEXT DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tenant_name ON suppliers(tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active ON suppliers(tenant_id) WHERE active = TRUE;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON suppliers
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ON DELETE SET NULL e não CASCADE: apagar um fornecedor não pode levar consigo o
-- histórico de encomendas que já foram feitas a ele.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id) WHERE supplier_id IS NOT NULL;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
