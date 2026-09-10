-- ─── ENCADEAMENTO PRÉ E PÓS-CONSULTA ────────────────────────────────────────
-- As peças existiam todas: tarefas (patient_tasks), checklists, consentimentos
-- (consent_forms), documentos (document_templates), dados em falta (lib/missingData.ts)
-- e recalls. O que não existia era a SEQUÊNCIA — nada se disparava a partir do tipo de
-- consulta. Uma clínica que marca um implante para quinta-feira tinha de se lembrar, à
-- mão, de gerar o consentimento, confirmar o jejum e verificar a morada. Lembrar-se à
-- mão é precisamente o que este produto existe para dispensar.
--
-- O padrão já estava escrito noutro sítio: procedure_item_usage (migração 029) liga
-- tipo de consulta a material consumido, e é isso que permite prever compras a partir
-- da agenda. Isto é a mesma ligação para trabalho em vez de material.
--
-- ─── Porque é que não há tabela de "execuções" ──────────────────────────────
-- A tentação óbvia era uma terceira tabela (care_pathway_runs) a marcar cada passo como
-- pendente/feito. Não existe de propósito. Um registo paralelo de progresso
-- dessincroniza-se no dia em que alguém assina um consentimento pelo caminho normal, e
-- passa a haver duas verdades sobre a mesma coisa. Em vez disso, um passo é DEVIDO
-- enquanto a prova de que está satisfeito não existir — o motor pergunta sempre à
-- realidade (lib/carePathwayCalc.ts:isStepSatisfied). É a mesma escolha que fez a etapa
-- da jornada (lib/patientJourneyCalc.ts) e o estágio de ciclo de vida serem derivados.
-- A consequência prática é que o job pode correr de hora a hora sem duplicar nada.

CREATE TABLE IF NOT EXISTS care_pathway_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- O tipo de consulta a que se aplica, tal como aparece em appointments.type. É texto
  -- livre e não uma chave estrangeira porque `appointments.type` também é — mudar isso
  -- é uma migração de outro âmbito, e copiá-la aqui manteria o problema em vez de o
  -- resolver duas vezes.
  appointment_type  TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Um percurso ativo por tipo de consulta e por clínica. Dois percursos ativos para
-- «Implante» produziriam passos duplicados sem que nada desse erro — o índice parcial
-- torna isso impossível em vez de o deixar à disciplina de quem configura.
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_pathway_active_per_type
  ON care_pathway_templates(tenant_id, lower(appointment_type)) WHERE active;

CREATE TABLE IF NOT EXISTS care_pathway_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES care_pathway_templates(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 1,
  phase         TEXT NOT NULL CHECK (phase IN ('pre', 'post')),
  action        TEXT NOT NULL
    CHECK (action IN ('task', 'consent', 'document', 'missing_data', 'portal_request', 'recall')),
  title         TEXT NOT NULL,
  -- Dias relativos à consulta. Negativo antes, positivo depois. A coerência entre isto
  -- e `phase` é validada em lib/carePathwayCalc.ts:validatePathwaySteps antes de
  -- gravar: um passo 'pre' com offset positivo ficaria devido depois da consulta, o que
  -- é sempre um lapso de sinal e nunca uma intenção.
  offset_days   INTEGER NOT NULL DEFAULT 0,
  -- Papéis elegíveis para a tarefa resultante. Vazio = fila partilhada. O filtro de
  -- papel de lib/taskRoutingCalc.ts é estrito e sem fallback, por isso um percurso que
  -- exija 'receptionist' num dia sem rececionista deixa a tarefa na fila em vez de a
  -- despejar num clínico.
  roles         TEXT[] NOT NULL DEFAULT '{}',
  -- Um passo bloqueante aparece como alerta e não como tarefa de rotina. Não impede
  -- nada tecnicamente — o software não cancela consultas.
  blocking      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Qual consentimento / qual template de documento / que tipo de recall. Obrigatório
  -- para essas três ações: sem isto o passo não teria como saber se já está satisfeito
  -- e ficaria devido para sempre.
  reference     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT care_pathway_steps_reference_required CHECK (
    action NOT IN ('consent', 'document', 'recall') OR (reference IS NOT NULL AND reference <> '')
  ),
  CONSTRAINT care_pathway_steps_phase_offset CHECK (
    (phase = 'pre' AND offset_days <= 0) OR (phase = 'post' AND offset_days >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_care_pathway_steps_template ON care_pathway_steps(template_id, position);

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['care_pathway_templates', 'care_pathway_steps'];
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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl
    );
  END LOOP;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
