-- ─── AGENDA INTELIGENTE — preferências de agendamento do paciente ─────────
-- Item 9 da automação lista "preferências dos pacientes" como um dos sinais a
-- analisar, ao lado de ocupação, especialidades e equipamentos. Até agora o
-- produto só sabia preferências ao nível de UMA entrada de lista de espera
-- (waitlist_entries.preferred_days/preferred_time_start/..., ver
-- 004_schedule_intel.sql) — ou seja, apenas para quem está à espera de uma vaga,
-- e apenas para aquele pedido concreto. Uma preferência estável do doente ("só
-- consigo de manhã", "quero sempre a Dra. Silva") não tinha onde viver, e por
-- isso nunca entrou nem na sugestão de horários (lib/scheduling.ts) nem em
-- qualquer análise de agenda.
--
-- O vocabulário é deliberadamente o MESMO de waitlist_entries — dias, janela
-- horária, dentista preferido. São o mesmo conceito a dois níveis (permanente
-- vs. para este pedido), e reutilizar os nomes evita inventar um segundo modelo
-- mental para a equipa e permite reaproveitar a UI que já existe.
--
-- UNIQUE em patient_id: é um perfil, não um histórico. Alterar a preferência
-- substitui, não acumula — daí o upsert em lib/schedulingPrefs.ts.
--
-- `patient_id` com ON DELETE CASCADE (e não RESTRICT como recalls/consent_forms,
-- ver 014_patient_deletion_restrict.sql): isto é uma preferência derivada, sem
-- valor legal nem de registo. Não há razão nenhuma para bloquear o apagamento de
-- um doente por causa dela, ao contrário de um consentimento assinado.
--
-- Tudo aqui é uma preferência SUAVE: lib/schedulingPrefsCalc.ts pontua, não
-- filtra. Um doente que só pode de manhã continua a poder ser marcado à tarde
-- numa urgência — o sistema apenas deixa de o sugerir primeiro e assinala-o.
CREATE TABLE IF NOT EXISTS patient_scheduling_prefs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id           UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  preferred_dentist_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 0=Domingo .. 6=Sábado, mesma convenção de waitlist_entries.preferred_days e
  -- de staff_schedules.weekday. NULL ou vazio = qualquer dia serve.
  preferred_days       SMALLINT[],
  preferred_time_start TIME,
  preferred_time_end   TIME,
  notes                TEXT NOT NULL DEFAULT '',
  updated_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  -- Uma janela invertida não é uma preferência exprimível, é um erro de
  -- introdução — recusado aqui além da validação na rota, como
  -- staff_schedules faz com end_time > start_time.
  CHECK (preferred_time_start IS NULL OR preferred_time_end IS NULL OR preferred_time_end > preferred_time_start)
);
CREATE INDEX IF NOT EXISTS idx_patient_scheduling_prefs_tenant ON patient_scheduling_prefs(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patient_scheduling_prefs' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE patient_scheduling_prefs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE patient_scheduling_prefs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON patient_scheduling_prefs
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON patient_scheduling_prefs;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON patient_scheduling_prefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
