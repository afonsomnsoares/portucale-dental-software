-- ─── Fechar Categorias 2-7 a 100%: especialidade/equipamento, portal do
-- paciente ────────────────────────────────────────────────────────────────
-- Três peças de schema independentes, todas necessárias para fechar os gaps
-- identificados na auditoria (ver plano em /home/afonso/.claude/plans):
--
-- 1. `users.specialties` — um dentista pode ter zero ou mais especialidades
--    (Ortodontia, Implantologia, ...). Só é significativo para role='dentist',
--    mas fica na tabela users (não numa tabela própria) pelo mesmo motivo de
--    `clinic` já estar lá: é um atributo do profissional, não uma entidade
--    com ciclo de vida próprio.
--
-- 2. `clinic_equipment` — a versão mínima de "equipamento" que a Categoria 2
--    (marcação) e a Categoria 3 (cancelamentos) precisam: que cadeira tem
--    que equipamento, para lib/scheduling.ts poder filtrar sugestões e
--    lib/waitlist.ts poder verificar antes de oferecer uma vaga. Não é a
--    Categoria 14 (manutenção/alertas/histórico) — isso fica para quando
--    essa categoria for pedida.
--
-- 3. `patient_portal_tokens` — a Categoria 4 (gestão do paciente) precisa de
--    uma forma de o paciente preencher dados em falta, enviar um documento
--    pedido, ou assinar um consentimento sem precisar de sessão — mesmo
--    padrão de token hash-only já usado por `lead_capture_sources`
--    (023_lead_capture_sources.sql): nunca se guarda o token em claro, só o
--    hash; o endpoint público (app/api/public/patient-portal/[token]) resolve
--    por hash e corre sob withSystemContext() como app/api/public/leads faz.
--    Uso único (`used_at`) e com expiração curta.

ALTER TABLE users ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS clinic_equipment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  chair       INTEGER,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinic_equipment_tenant ON clinic_equipment(tenant_id, active);

CREATE TABLE IF NOT EXISTS patient_portal_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- RESTRICT (no ON DELETE), same as recalls/consent_forms/treatment_plans —
  -- see 014_patient_deletion_restrict.sql.
  patient_id        UUID NOT NULL REFERENCES patients(id),
  task_id           UUID REFERENCES patient_tasks(id) ON DELETE SET NULL,
  consent_form_id   UUID REFERENCES consent_forms(id) ON DELETE SET NULL,
  purpose           TEXT NOT NULL CHECK (purpose IN ('missing_data', 'document_upload', 'consent_form')),
  token_hash        TEXT NOT NULL UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patient_portal_tokens_patient ON patient_portal_tokens(tenant_id, patient_id);

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['clinic_equipment', 'patient_portal_tokens'];
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

DROP TRIGGER IF EXISTS trg_set_updated_at ON clinic_equipment;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON clinic_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Categoria 7: parar reativação assim que o paciente volta a marcar ─────
-- queueRecallOutreach já para sozinho (NOT EXISTS future appointment).
-- queueLifecycleOutreach não tinha o mesmo mecanismo porque a "prova" de que
-- já foi contactado era só o cooldown de 30 dias — um paciente que remarca
-- no dia seguinte ao SMS continuava elegível até o cooldown expirar. Regista
-- quando cada paciente teve uma marcação futura criada pela última vez não é
-- necessário: basta lib/lifecycle.ts passar a excluir quem já tem consulta
-- futura, tal como lib/jobsRunner.ts's queueRecallOutreach já faz — sem
-- alteração de schema aqui, só lógica (ver lib/lifecycle.ts).
