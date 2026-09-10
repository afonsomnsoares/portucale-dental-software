-- ─── COORDENAÇÃO ENTRE AGENTES ──────────────────────────────────────────────
-- lib/agents/registry.ts diz a frase certa: «a comunicação não é um agente — é o canal
-- por onde todos passam, e por isso a política vive num sítio só». A política que lá
-- vivia era, no entanto, metade: consentimento (lib/commPrefs.ts) e deduplicação POR
-- TIPO de mensagem. Deduplicação por tipo impede dois lembretes para a mesma consulta e
-- não impede nada entre agentes diferentes.
--
-- Na prática, um doente com uma consulta amanhã, um plano por responder, um recall
-- vencido e seis meses sem vir podia receber, na mesma passagem do cron, cinco SMS da
-- mesma clínica — dois deles a contradizerem-se, porque o quinto dizia que não o viam
-- há muito a quem o primeiro lembrava de vir amanhã. Cada agente estava certo
-- isoladamente.
--
-- Esta tabela é o livro de registo do árbitro (lib/agents/coordinationCalc.ts): o que
-- se pediu, o que saiu, e o que cedeu a quê. Existe por duas razões e a segunda é tão
-- importante como a primeira:
--
--   1. contar contactos por doente e por dia sem ter de reconstruir isso a partir de
--      `notifications`, que não sabe que agente pediu o quê;
--   2. tornar as cedências LEGÍVEIS. Um árbitro em que ninguém consegue ver quem cedeu
--      a quem é um árbitro em que ninguém confia, e a primeira coisa que uma clínica
--      pergunta quando um SMS não sai é porquê.

CREATE TABLE IF NOT EXISTS agent_contact_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- SET NULL, como em notifications: o registo de que se contactou alguém sobrevive ao
  -- apagamento do doente, sem o identificar.
  patient_id   UUID REFERENCES patients(id) ON DELETE SET NULL,
  agent_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  -- 'granted' saiu; 'deferred' perdeu a vez e volta a pedir; 'rejected' não se aplica e
  -- não volta. A distinção entre os dois últimos é o que impede um agente de insistir
  -- para sempre numa coisa que nunca vai poder fazer.
  decision     TEXT NOT NULL CHECK (decision IN ('granted', 'deferred', 'rejected')),
  reason       TEXT DEFAULT '',
  -- Ligação à mensagem que efetivamente saiu, quando saiu.
  notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- O índice que serve a pergunta quente: «quantas vezes é que este doente já foi
-- contactado hoje?», feita uma vez por doente em cada passagem do cron.
CREATE INDEX IF NOT EXISTS idx_agent_contact_ledger_budget
  ON agent_contact_ledger(tenant_id, patient_id, created_at DESC)
  WHERE decision = 'granted';
CREATE INDEX IF NOT EXISTS idx_agent_contact_ledger_agent
  ON agent_contact_ledger(tenant_id, agent_id, created_at DESC);

ALTER TABLE agent_contact_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_contact_ledger FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='agent_contact_ledger' AND policyname='tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON agent_contact_ledger
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
