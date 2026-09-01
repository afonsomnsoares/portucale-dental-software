-- ─── Categoria 13: previsão de necessidades por procedimento agendado ─────
-- Hoje lib/inventory.ts's computeInventoryOverview só prevê rutura a partir da taxa de
-- consumo histórica — nunca olha para o que já está marcado na agenda. Esta tabela deixa
-- cada clínica dizer "uma consulta do tipo X consome Y unidades do item Z", para
-- lib/inventory.ts's computeProcedureDemandForecast poder somar isso contra as consultas
-- futuras e responder à pergunta do próprio pedido: "precisamos de quantas unidades para
-- os procedimentos previstos nos próximos 14 dias".
--
-- `appointment_type` é texto livre (não uma FK) — mesmo idioma que appointments.type e
-- lib/constants.ts's APPOINTMENT_TYPES: uma lista fixa sugerida, mas nunca imposta pela
-- BD. `item_id` referencia inventory_items, que é uma tabela global (sem tenant_id, ver
-- scripts/schema.sql) partilhada entre clínicas — só o mapeamento "quanto é que ESTA
-- clínica consome" é que é por tenant.
CREATE TABLE IF NOT EXISTS procedure_item_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_type  TEXT NOT NULL,
  item_id           INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty_per_procedure NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty_per_procedure > 0),
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, appointment_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_procedure_item_usage_tenant ON procedure_item_usage(tenant_id, appointment_type);

DO $$
BEGIN
  ALTER TABLE procedure_item_usage ENABLE ROW LEVEL SECURITY;
  ALTER TABLE procedure_item_usage FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'procedure_item_usage' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON procedure_item_usage
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON procedure_item_usage;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON procedure_item_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
