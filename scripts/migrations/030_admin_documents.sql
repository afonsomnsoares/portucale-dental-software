-- ─── OPERAÇÃO DO DENTISTA — documentação administrativa ──────────────────
-- Item 10 da automação ("documentação não clínica"): hoje a única coisa que se
-- aproxima de um documento gerado pela clínica são os consent_forms — e esses
-- são um upload de assinatura, não um texto composto pela clínica. Uma
-- declaração de presença, uma justificação de falta ao trabalho ou uma carta
-- de encaminhamento administrativo são escritas à mão, fora do sistema, todas
-- as vezes.
--
-- Duas tabelas, mesma divisão modelo/execução já usada em
-- checklist_templates/checklist_runs (025_clinic_operations.sql):
--
-- document_templates: o texto reutilizável, com marcadores {{variavel}}
-- resolvidos no momento da emissão (ver lib/documentsCalc.ts para o catálogo
-- de variáveis e o renderizador). `type` existe para agrupar/filtrar na UI,
-- não muda o comportamento do render.
--
-- generated_documents: o documento concreto emitido para um paciente, com o
-- corpo JÁ RENDERIZADO e guardado. É deliberadamente uma cópia congelada —
-- editar o modelo mais tarde não pode reescrever uma declaração que já foi
-- entregue e assinada em papel. Pela mesma razão `template_name` também é
-- copiado, e `template_id` fica ON DELETE SET NULL em vez de CASCADE: apagar
-- o modelo nunca apaga o histórico do que foi emitido.
--
-- `patient_id` sem ON DELETE (RESTRICT por omissão) — mesmo padrão de
-- recalls/consent_forms/treatment_plans, ver 014_patient_deletion_restrict.sql.
--
-- Nada aqui é clínico: o âmbito do item 10 é explicitamente administrativo, e
-- é por isso que não há nenhuma ligação a treatments/notes/prescriptions.
CREATE TABLE IF NOT EXISTS document_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'declaration'
    CHECK (type IN ('declaration', 'justification', 'letter', 'other')),
  -- Assunto/título por omissão do documento emitido; também aceita marcadores.
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_templates_tenant ON document_templates(tenant_id, active);

CREATE TABLE IF NOT EXISTS generated_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id    UUID REFERENCES document_templates(id) ON DELETE SET NULL,
  template_name  TEXT NOT NULL,
  type           TEXT NOT NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id),
  -- Snapshot do nome à data de emissão, mesma razão de appointments.patient_name.
  patient_name   TEXT NOT NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  -- As variáveis efetivamente usadas no render, para se poder auditar depois
  -- porque é que o texto ficou assim sem depender do estado atual do paciente.
  variables      JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_by      UUID REFERENCES users(id),
  issued_by_name TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant ON generated_documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_patient ON generated_documents(patient_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'document_templates' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON document_templates
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'generated_documents' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE generated_documents FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON generated_documents
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON document_templates;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
