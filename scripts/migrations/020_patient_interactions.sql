-- ─── GESTÃO DO PACIENTE: registo de interações + preferências de comunicação ──
-- `patient_timeline` já regista toda mutação feita pelo sistema (mudança de
-- estado, tratamento, fatura, nota), mas não tem forma de a equipa registar
-- um contacto que não gerou nenhuma mutação — "liguei e não atendeu",
-- "respondeu ao WhatsApp a confirmar", "pediu para não ligar antes das 10h".
-- patient_interactions cobre isso; a rota (app/api/patient-interactions)
-- também escreve uma linha em patient_timeline com event_type='interaction'
-- para continuar a aparecer na cronologia mestre do paciente.
--
-- `comm_prefs` segue o mesmo padrão já usado por `custom_fields` (JSONB
-- solto, documentado em código — ver lib/types/patient.ts — em vez de mais
-- uma tabela/colunas fixas) porque a forma é pequena e não precisa de ser
-- pesquisável por SQL.
CREATE TABLE IF NOT EXISTS patient_interactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id   UUID REFERENCES patients(id),
  channel      TEXT NOT NULL CHECK (channel IN ('phone', 'email', 'whatsapp', 'sms', 'in_person', 'other')),
  direction    TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
  summary      TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_interactions_patient
  ON patient_interactions(patient_id, occurred_at DESC);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS comm_prefs JSONB DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patient_interactions' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE patient_interactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE patient_interactions FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON patient_interactions
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
