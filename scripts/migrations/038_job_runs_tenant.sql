-- job_runs regista cada execução do lib/jobsRunner.ts, mas nasceu sem `tenant_id`:
-- o runJob() recebe sempre um tenant, só que o logJobRun() não o guardava. Enquanto
-- ninguém lia a tabela pela UI isso não se notava. A página de Agentes
-- (/dashboard/admin/agents) passa a lê-la, e sem esta coluna um admin de clínica
-- veria as execuções de todas as outras — o mesmo tipo de fuga que já existe em
-- GET /api/inventory.
--
-- A coluna fica NULLABLE de propósito: as linhas antigas não têm como ser
-- atribuídas a nenhuma clínica. Com a política RLS abaixo, `tenant_id = <uuid>` é
-- NULL para essas linhas — logo não passam o filtro e ficam invisíveis para quem
-- não é super_admin. Invisível é o comportamento seguro; atribuí-las a uma clínica
-- ao acaso seria pior.
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- A página lê sempre "a última execução de cada job desta clínica".
CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_job ON job_runs (tenant_id, job_name, started_at DESC);

-- Obrigatório: assim que a tabela ganha `tenant_id`, a view tenant_tables_without_rls
-- (migração 033) passa a listá-la e o test/integration/rls-coverage.test.ts falha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_runs' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON job_runs
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
