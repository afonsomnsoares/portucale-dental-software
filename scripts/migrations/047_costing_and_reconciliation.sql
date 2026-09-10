-- ─── CUSTO E MARGEM ─────────────────────────────────────────────────────────
-- Até esta migração o modelo de dados tinha UMA coluna de custo em toda a base:
-- equipment_maintenance.cost (migração 043). `inventory_items` não tinha preço,
-- `purchase_order_items` não tinha custo unitário, e não existia nenhuma noção de custo
-- fixo. A consequência não era uma funcionalidade em falta — era metade do «financeiro»
-- a ser impossível: sem custo não há margem, e «receita por dentista», «receita por
-- cadeira» e «receita por tratamento» ficavam a meio caminho, a dizer quanto entrou e
-- nunca quanto sobrou. A cadeira que mais fatura pode ser a que menos dá, e não havia
-- como saber.
--
-- A aritmética já estava toda construída (lib/costingCalc.ts). Isto são as colunas.

-- ─── 1. Preço de catálogo, override por clínica ─────────────────────────────
-- Mesmo padrão da migração 044 para o ponto de reposição, e pela mesma razão: o
-- catálogo de itens é partilhado (ninguém quer manter a mesma lista de luvas em vinte
-- clínicas) mas o PREÇO não é partilhável — cada clínica compra a quem quer, ao preço
-- que negociou. O global é referência; a linha da clínica manda quando existe.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC
  CHECK (unit_cost IS NULL OR unit_cost >= 0);
COMMENT ON COLUMN inventory_items.unit_cost IS
  'Custo unitário de referência do catálogo global. NULL = sem preço conhecido (ver lib/costingCalc.ts:unitCostFor).';

ALTER TABLE inventory_item_settings ADD COLUMN IF NOT EXISTS unit_cost NUMERIC
  CHECK (unit_cost IS NULL OR unit_cost >= 0);
COMMENT ON COLUMN inventory_item_settings.unit_cost IS
  'Custo unitário desta clínica para este item. NULL = segue o catálogo global.';

-- ─── 2. Custo no momento em que entrou ──────────────────────────────────────
-- No lote e não só no item: é o que permite o custo médio ponderado
-- (lib/costingCalc.ts:weightedAverageCost) e é o que torna auditável a diferença entre
-- o que se pagou em janeiro e o que se paga hoje. Sem isto, mudar o preço de catálogo
-- reescreveria retroativamente o custo de tudo o que já saiu.
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS unit_cost NUMERIC
  CHECK (unit_cost IS NULL OR unit_cost >= 0);

-- ─── 3. As três versões de uma encomenda ────────────────────────────────────
-- Uma encomenda tem três versões de si própria e só por acaso coincidem: o que se
-- PEDIU, o que CHEGOU e o que se PAGOU. Marcar como 'received' — que era tudo o que o
-- sistema fazia — assume que as três são a mesma. Na prática o fornecedor manda 8 das
-- 10 caixas, sobe o preço unitário sem avisar, ou junta um item que ninguém pediu.
-- Nenhuma dessas coisas dava erro em lado nenhum: entravam no stock como verdade e a
-- diferença descobria-se meses depois. Ver lib/inventoryCalc.ts:summarizeReconciliation.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC
  CHECK (unit_cost IS NULL OR unit_cost >= 0);
-- Quantidade efetivamente recebida, quando difere da pedida. NULL enquanto a encomenda
-- não for rececionada — distinto de 0, que significa «chegou e não veio nada».
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity INTEGER
  CHECK (received_quantity IS NULL OR received_quantity >= 0);
-- Custo unitário efetivamente faturado, quando difere do encomendado.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_unit_cost NUMERIC
  CHECK (received_unit_cost IS NULL OR received_unit_cost >= 0);

-- O total da fatura do fornecedor: a terceira versão, a que o dinheiro segue. É esta
-- que apanha portes, taxas e descontos que não existem em nenhuma linha.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoiced_total NUMERIC
  CHECK (invoiced_total IS NULL OR invoiced_total >= 0);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_invoice_ref TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- Congelado como texto no momento da reconciliação, e não recalculado a cada leitura.
-- É a mesma escolha da passagem de turno (migração 036): uma reconciliação é o que se
-- concluiu naquele momento, com os dados daquele momento — não uma vista que muda
-- sozinha quando alguém corrige o stock três semanas depois.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reconciliation JSONB;

-- ─── 4. Custo fixo e a base de imputação ────────────────────────────────────
-- Somar o custo direto é aritmética. Imputar o custo FIXO é contabilidade: a mesma
-- clínica com os mesmos números dá margens diferentes conforme a base, e nenhuma das
-- bases está «certa». Por isso o método é um campo e não uma constante no código —
-- ver ALLOCATION_METHODS em lib/costingCalc.ts.
CREATE TABLE IF NOT EXISTS tenant_cost_settings (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- 'per_chair_hour' por omissão: é a base que torna comparáveis as duas coisas que
  -- este produto já mede por cadeira e por hora, e a capacidade de uma clínica
  -- dentária é literalmente cadeiras × horas.
  allocation_method    TEXT NOT NULL DEFAULT 'per_chair_hour'
    CHECK (allocation_method IN ('direct_only', 'per_chair_hour', 'per_appointment')),
  -- Custo fixo mensal: renda, salários não clínicos, software, seguros, amortizações.
  -- NULL = ainda não declarado, e nesse caso a margem líquida iguala a de contribuição
  -- em vez de fingir um valor.
  fixed_cost_monthly   NUMERIC CHECK (fixed_cost_monthly IS NULL OR fixed_cost_monthly >= 0),
  -- Custo/hora de clínico. Zero e NULL comportam-se igual (lib/costingCalc.ts:labourCost
  -- devolve 0), porque inventar uma média de mercado produziria uma margem com
  -- aparência de rigor e nenhum.
  labour_cost_per_hour NUMERIC CHECK (labour_cost_per_hour IS NULL OR labour_cost_per_hour >= 0),
  notes                TEXT DEFAULT '',
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Custo/hora por dentista, quando a clínica quer distinguir. Sobrepõe-se ao valor da
-- clínica; NULL segue o da clínica. Mesma lógica de catálogo/override de sempre.
ALTER TABLE users ADD COLUMN IF NOT EXISTS labour_cost_per_hour NUMERIC
  CHECK (labour_cost_per_hour IS NULL OR labour_cost_per_hour >= 0);

ALTER TABLE tenant_cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_cost_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='tenant_cost_settings' AND policyname='tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON tenant_cost_settings
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON tenant_cost_settings;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON tenant_cost_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Índice para a lista de produtos parados: a consulta filtra por movimento de consumo
-- mais recente por item, e sem isto varre a tabela inteira de movimentos.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_consumed
  ON inventory_movements(tenant_id, item_id, created_at DESC)
  WHERE reason = 'consumed';

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
