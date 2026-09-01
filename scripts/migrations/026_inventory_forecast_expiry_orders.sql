-- ─── INVENTÁRIO — Fase 2: consumo/previsão, validade, automação de encomendas ─
-- Item 13 da automação: hoje o inventário só tem item mestre + stock por tenant
-- que se sobrescreve diretamente (app/api/inventory) — sem histórico, sem lotes
-- com validade, sem sugestão de reposição. Estas quatro tabelas mudam isso:
--
-- inventory_batches: stock por lote com data de validade opcional. `quantity`
-- é a quantidade ainda disponível NESSE lote (desce à medida que se consome
-- dele); um lote nunca é apagado quando chega a 0 — fica como registo
-- histórico de que existiu.
--
-- inventory_movements: todo o ajuste de stock passa a ficar registado aqui
-- (recebido/consumido/ajustado/quebra/expirado), com o lote associado quando
-- aplicável — é isto que dá histórico real para calcular uma taxa de consumo
-- (lib/inventoryCalc.ts's computeConsumptionRate) em vez de só ver a
-- quantidade atual. inventory_stock (já existente) continua a guardar o
-- total atual por tenant — mantido em sincronia por lib/inventory.ts's
-- applyMovement, nunca escrito diretamente à margem disso a partir de agora
-- pelas rotas novas (a rota antiga app/api/inventory continua a existir tal
-- como está, para o ledger cross-clinic do super-admin).
--
-- purchase_orders / purchase_order_items: uma encomenda de reposição —
-- 'auto' quando gerada por lib/jobsRunner.ts's generateReorderSuggestions
-- (stock em risco de rutura), 'manual' quando criada por um admin. Sem
-- integração real com fornecedores: "automação" aqui é o sistema propor a
-- encomenda sozinho; marcar como encomendada/recebida continua a ser uma
-- ação humana. Receber uma encomenda cria lotes + movimentos 'received' via
-- lib/inventory.ts's receivePurchaseOrder, fechando o ciclo com as tabelas
-- acima. purchase_order_items guarda o próprio tenant_id (em vez de só
-- purchase_order_id) para poder ter a mesma política de RLS simples que
-- todas as outras tabelas deste projeto, em vez de depender de um join à
-- tabela-mãe.
CREATE TABLE IF NOT EXISTS inventory_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_number  TEXT DEFAULT '',
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  expiry_date   DATE,
  received_at   TIMESTAMPTZ DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_tenant_item ON inventory_batches(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON inventory_batches(tenant_id, expiry_date);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_id    UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
  delta       INTEGER NOT NULL CHECK (delta <> 0),
  reason      TEXT NOT NULL CHECK (reason IN ('received', 'consumed', 'adjusted', 'wastage', 'expired')),
  notes       TEXT DEFAULT '',
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_item ON inventory_movements(tenant_id, item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
  notes         TEXT DEFAULT '',
  created_by    UUID REFERENCES users(id),
  ordered_at    TIMESTAMPTZ,
  received_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id            INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  expiry_date        DATE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (purchase_order_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['inventory_batches', 'inventory_movements', 'purchase_orders', 'purchase_order_items'];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        $f$CREATE POLICY tenant_isolation ON %I
             USING (current_setting('app.is_super_admin', true) = 'true'
                    OR tenant_id = current_setting('app.tenant_id', true)::uuid)
             WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                         OR tenant_id = current_setting('app.tenant_id', true)::uuid)$f$,
        tbl
      );
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON inventory_batches;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON inventory_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON purchase_orders;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
