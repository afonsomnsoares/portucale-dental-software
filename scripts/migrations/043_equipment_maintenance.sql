-- ─── Manutenção de equipamento ──────────────────────────────────────────────────
-- clinic_equipment nasceu com o mínimo para o otimizador de agenda saber que cadeira
-- tem que equipamento (name, chair, tags). O próprio ficheiro da rota admitia que o
-- resto era "separate, later scope": calendário de manutenção, alertas e histórico.
--
-- O que isto acrescenta é a diferença entre "o equipamento existe" e "o equipamento
-- está a funcionar hoje". Sem ela, ninguém sabe que a cadeira 2 está com o raio-x
-- avariado até ter o doente sentado — e o otimizador de agenda continua a marcar lá
-- procedimentos que precisam desse equipamento.

-- 'operational' por omissão: tudo o que já existe estava implicitamente a funcionar.
ALTER TABLE clinic_equipment ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'operational'
  CHECK (status IN ('operational', 'maintenance', 'broken'));
ALTER TABLE clinic_equipment ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE clinic_equipment ADD COLUMN IF NOT EXISTS last_serviced_at DATE;
-- NULL = este equipamento não tem revisão periódica (um armário não precisa; um
-- autoclave precisa). Só os que têm intervalo entram no cálculo de revisão vencida.
ALTER TABLE clinic_equipment ADD COLUMN IF NOT EXISTS service_interval_days INTEGER
  CHECK (service_interval_days IS NULL OR service_interval_days > 0);
ALTER TABLE clinic_equipment ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- A varredura do job é "o que tem revisão a vencer" — índice parcial, mesmo raciocínio
-- do idx_leads_untriaged (migração 040).
CREATE INDEX IF NOT EXISTS idx_equipment_service_due
  ON clinic_equipment(tenant_id, last_serviced_at)
  WHERE active = TRUE AND service_interval_days IS NOT NULL;

-- ─── Histórico de assistências ──────────────────────────────────────────────────
-- Uma linha por intervenção. O `last_serviced_at` do equipamento é a cópia da mais
-- recente — desnormalizado de propósito, porque a pergunta "está vencido?" é feita a
-- cada corrida do job para todos os equipamentos, e não vale um JOIN de cada vez.
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES clinic_equipment(id) ON DELETE CASCADE,
  serviced_at  DATE NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'preventive' CHECK (kind IN ('preventive', 'corrective', 'inspection')),
  technician   TEXT DEFAULT '',
  cost         NUMERIC CHECK (cost IS NULL OR cost >= 0),
  notes        TEXT DEFAULT '',
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_equipment
  ON equipment_maintenance(tenant_id, equipment_id, serviced_at DESC);

ALTER TABLE equipment_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_maintenance FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'equipment_maintenance' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON equipment_maintenance
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
