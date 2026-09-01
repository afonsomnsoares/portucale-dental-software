-- ─── GESTÃO DO PACIENTE: tarefas e lembretes ──────────────────────────────
-- Hoje não existe nenhuma forma de a equipa (rececionista ou dentista) criar
-- um lembrete ligado a um paciente — "ligar a confirmar", "pedir documento",
-- "fazer follow-up ao plano" só existiam como memória de quem atendeu. Esta
-- tabela cobre isso com um único conceito genérico (`type`) em vez de uma
-- tabela por tipo de lembrete: uma tarefa "generic"/"call"/"follow_up" é um
-- lembrete simples; uma tarefa "document_request" é também a forma como a
-- Fase C (021_upload_categories.sql) representa um pedido de documento
-- pendente — o upload que a resolve referencia esta linha por `task_id`.
--
-- `patient_id` fica sem ON DELETE, RESTRICT por omissão — mesmo padrão de
-- recalls/consent_forms/treatment_plans, ver
-- scripts/migrations/014_patient_deletion_restrict.sql.
--
-- `assigned_to` NULL significa "fila da equipa" (qualquer um pode assumir),
-- não "sem dono" — a UI trata isso como uma fila partilhada.
--
-- RLS e o trigger de updated_at para esta tabela ficam na migração seguinte
-- (019), não aqui, para poder reutilizar exatamente o mesmo bloco DO $$ já
-- usado em 011/016 sem reescrever o array inteiro nesta.
CREATE TABLE IF NOT EXISTS patient_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id),
  type          TEXT NOT NULL DEFAULT 'generic'
    CHECK (type IN ('generic', 'call', 'document_request', 'follow_up', 'data_missing')),
  title         TEXT NOT NULL,
  notes         TEXT DEFAULT '',
  due_at        TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  assigned_to   UUID REFERENCES users(id),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_tasks_open
  ON patient_tasks(tenant_id, status, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_patient_tasks_patient ON patient_tasks(patient_id);
