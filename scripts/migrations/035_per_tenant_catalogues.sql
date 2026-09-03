-- ─── Catálogos por clínica: treatment_codes e statuses ────────────────────────
-- Ambas as tabelas nasceram com uma chave primária de coluna única e sem
-- `tenant_id`, o que num produto multi-tenant significa que TODAS as clínicas
-- partilham a mesma tabela de preços TANOMD e o mesmo workflow de estados de
-- marcação. A primeira clínica que quisesse praticar os seus próprios preços
-- — ou seja, a primeira clínica real — não tinha por onde o fazer, e alterar
-- um preço mexia no de toda a gente.
--
-- O modelo escolhido é o mesmo que `schema_fields` já usa neste schema, para
-- não introduzir um segundo padrão para o mesmo problema:
--
--   tenant_id IS NULL      → linha do catálogo global (o que o seed instala)
--   tenant_id = <clínica>  → override dessa clínica para aquele código/estado
--
-- Uma clínica sobrepõe só os códigos que quer repricar; os restantes continuam
-- a vir do catálogo global, sem cópia por tenant nem trabalho de manutenção.
-- A resolução (override ganha ao global) está em app/api/settings/route.ts.
--
-- Idempotente: cada passo verifica o catálogo do Postgres antes de agir.

-- ─── treatment_codes ─────────────────────────────────────────────────────────
ALTER TABLE treatment_codes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

DO $$
BEGIN
  -- A PK de coluna única impede duas clínicas de terem o mesmo código. Passa a
  -- ser um id sintético; a unicidade real fica nos índices parciais abaixo.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'treatment_codes'::regclass AND contype = 'p' AND conname = 'treatment_codes_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'treatment_codes'::regclass AND attname = 'id' AND NOT attisdropped
  ) THEN
    ALTER TABLE treatment_codes DROP CONSTRAINT treatment_codes_pkey;
    ALTER TABLE treatment_codes ADD COLUMN id BIGSERIAL PRIMARY KEY;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_codes_tenant_code
  ON treatment_codes(tenant_id, code) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_codes_global_code
  ON treatment_codes(code) WHERE tenant_id IS NULL;

-- ─── statuses ────────────────────────────────────────────────────────────────
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'statuses'::regclass AND contype = 'p' AND conname = 'statuses_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'statuses'::regclass AND attname = 'id' AND NOT attisdropped
  ) THEN
    ALTER TABLE statuses DROP CONSTRAINT statuses_pkey;
    ALTER TABLE statuses ADD COLUMN id BIGSERIAL PRIMARY KEY;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_tenant_key
  ON statuses(tenant_id, key) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_global_key
  ON statuses(key) WHERE tenant_id IS NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Mesma política de schema_fields: a linha global (tenant_id IS NULL) é visível
-- a toda a gente, o override só à clínica dona. O WITH CHECK impede uma clínica
-- de escrever um override em nome de outra — ou de reescrever o catálogo global,
-- que só o super-admin pode tocar.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['treatment_codes','statuses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        $f$CREATE POLICY tenant_isolation ON %I
             USING (current_setting('app.is_super_admin', true) = 'true'
                    OR tenant_id IS NULL
                    OR tenant_id = current_setting('app.tenant_id', true)::uuid)
             WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                         OR tenant_id = current_setting('app.tenant_id', true)::uuid)$f$,
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
