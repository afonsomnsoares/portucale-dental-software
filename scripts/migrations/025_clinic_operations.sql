-- ─── OPERAÇÕES DA CLÍNICA — Fase 1: checklists + incidentes ──────────────
-- Item 12 da automação: hoje não há checklists de abertura/fecho nem forma
-- de reportar e seguir um incidente até resolução. Duas frentes pequenas e
-- independentes que cabem na mesma fase.
--
-- checklist_templates: lista de itens reutilizável definida pelo admin (ex:
-- "Abertura da manhã": ligar equipamentos, verificar stock de luvas...).
-- `items` é um array JSONB de strings — mesmo padrão de invoices.items
-- (scripts/schema.sql) — porque a ordem importa e não há necessidade de
-- referenciar um item individualmente fora do contexto do seu template/run.
--
-- checklist_runs: uma execução concreta num dia (uma linha por template+dia,
-- por isso o UNIQUE), com o estado de cada item ({label, checked, checkedBy,
-- checkedByName, checkedAt}) copiado do template no momento da criação —
-- editar o template mais tarde não altera o histórico de execuções já
-- feitas. `template_name`/`type` também são copiados por essa razão.
--
-- incidents: reportar/seguir um incidente até resolução, com severidade e
-- responsável. "Escalamento" nesta fase é status+severidade+assigned_to;
-- alertas automáticos (ex.: SMS/email ao admin em incidentes críticos)
-- ficam para uma fase seguinte — dependem da mesma infraestrutura de jobs
-- que hoje só serve notificações a pacientes (lib/jobsRunner.ts).
CREATE TABLE IF NOT EXISTS checklist_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'opening' CHECK (type IN ('opening', 'closing', 'other')),
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant ON checklist_templates(tenant_id, active);

CREATE TABLE IF NOT EXISTS checklist_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  type          TEXT NOT NULL,
  run_date      DATE NOT NULL,
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  started_by    UUID REFERENCES users(id),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (template_id, run_date)
);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_tenant_date ON checklist_runs(tenant_id, run_date);

CREATE TABLE IF NOT EXISTS incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'other'
                       CHECK (category IN ('equipment', 'patient_safety', 'complaint', 'security', 'other')),
  severity          TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  reported_by       UUID REFERENCES users(id),
  assigned_to       UUID REFERENCES users(id),
  resolution_notes  TEXT DEFAULT '',
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checklist_templates' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON checklist_templates
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checklist_runs' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE checklist_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE checklist_runs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON checklist_runs
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON incidents
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON checklist_templates;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON checklist_runs;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON checklist_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON incidents;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
