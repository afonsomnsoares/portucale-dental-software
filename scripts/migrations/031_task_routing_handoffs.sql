-- ─── GESTÃO DA EQUIPA — Fase 2: distribuição de tarefas + passagem de turno ─
-- Item 11 tinha duas lacunas depois da Fase 1 (024_staff_schedules.sql):
--
--   1. "distribuição de tarefas" — patient_tasks já tem `assigned_to`, mas
--      NADA o preenche automaticamente. Todas as tarefas criadas pelos jobs
--      (escalamento de incidentes, checklists por iniciar, follow-up pós-alta)
--      nascem com assigned_to NULL, ou seja, na fila partilhada, à espera que
--      alguém repare nelas. A distribuição em si não precisa de tabela nova —
--      lib/taskRouting.ts calcula o destinatário a partir de staff_schedules +
--      staff_time_off + carga aberta — mas precisa de conseguir distinguir
--      depois "isto foi o sistema que atribuiu" de "isto foi uma pessoa que
--      escolheu", por duas razões: a UI mostra-o, e a varredura periódica
--      (job assignOrphanTasks) nunca deve reatribuir por cima de uma escolha
--      humana. Daí a coluna abaixo, e não uma tabela.
--
--   2. "handoffs" — não existia nada. shift_handoffs é a passagem de turno:
--      quem entrega, para quem (ou para o turno seguinte em geral, com
--      to_user_id NULL — mesma convenção de "fila da equipa" que
--      patient_tasks.assigned_to NULL usa em 018), o que fica pendente, e a
--      confirmação de que o turno seguinte leu.
--
-- `items` é um array JSONB de strings, mesmo padrão de checklist_templates.items
-- (025) — ordem importa, e nenhum item precisa de ser referenciado
-- individualmente fora do contexto da sua passagem. É pré-preenchido a partir
-- do estado real da clínica (ver lib/shiftHandoff.ts's computeHandoffDraft) mas
-- guardado como texto congelado: uma passagem de turno é o que foi dito
-- naquele momento, não uma vista que se recalcula amanhã.
--
-- Sem UNIQUE em (tenant_id, from_user_id, handoff_date): um turno partido
-- (manhã + tarde, já suportado por staff_schedules) pode legitimamente gerar
-- duas passagens no mesmo dia pela mesma pessoa. `shift_label` distingue-as.
ALTER TABLE patient_tasks
  ADD COLUMN IF NOT EXISTS auto_assigned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS shift_handoffs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  handoff_date     DATE NOT NULL,
  shift_label      TEXT NOT NULL DEFAULT 'other'
    CHECK (shift_label IN ('morning', 'afternoon', 'evening', 'other')),
  from_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = "para quem entrar a seguir", não "sem destinatário" — a UI trata-o
  -- como uma passagem aberta que qualquer pessoa do turno seguinte pode
  -- confirmar, tal como patient_tasks.assigned_to NULL é uma fila partilhada.
  to_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notes            TEXT NOT NULL DEFAULT '',
  items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  acknowledged_by  UUID REFERENCES users(id),
  acknowledged_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shift_handoffs_tenant_date
  ON shift_handoffs(tenant_id, handoff_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_handoffs_open
  ON shift_handoffs(tenant_id, status) WHERE status = 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_handoffs' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE shift_handoffs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shift_handoffs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON shift_handoffs
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON shift_handoffs;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON shift_handoffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
