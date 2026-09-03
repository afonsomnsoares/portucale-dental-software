-- ─── agent_insights: o que os agentes de análise encontram ──────────────────────
-- Os agentes que agem escrevem no domínio deles (o Operações mexe em purchase_orders,
-- o Lead em leads). Os agentes de análise — Agenda, Finanças, Gestão, Grupo — não têm
-- domínio próprio para escrever: o que produzem é uma leitura ("isto está a correr
-- mal, por esta razão, custa-te este valor"). Isso vive aqui, numa tabela só, em vez
-- de quatro tabelas quase iguais.
--
-- `data` guarda os números que sustentam a conclusão, tal como o agente os recebeu, para
-- a página poder mostrar a evidência em vez de só a frase — e para se poder auditar
-- depois se a IA inventou um número (nunca deve: o payload dela vem sempre de cálculo
-- determinístico já feito noutro sítio).
CREATE TABLE IF NOT EXISTS agent_insights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = insight de plataforma (o agente Grupo compara clínicas, não pertence a
  -- nenhuma). As políticas de RLS abaixo tratam esse caso explicitamente.
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  -- Valor em euros que o agente atribui ao problema, quando faz sentido quantificá-lo
  -- (Gestão: "quantifica perdas"). NULL quando o insight não é sobre dinheiro.
  impact_eur  NUMERIC,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Quem já leu/tratou. Um insight não se apaga sozinho: fica no histórico.
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_insights_tenant_agent
  ON agent_insights(tenant_id, agent_id, created_at DESC);
-- A varredura normal da página é "o que está por tratar" — índice parcial, mesmo
-- raciocínio do idx_leads_untriaged da migração 040.
CREATE INDEX IF NOT EXISTS idx_agent_insights_open
  ON agent_insights(tenant_id, created_at DESC) WHERE resolved_at IS NULL;

-- RLS: mesma política das outras tabelas com tenant_id (ver 011_row_level_security.sql),
-- com o caso extra do insight de plataforma (tenant_id IS NULL), que só o super-admin vê.
-- O WITH CHECK não deixa uma clínica escrever um insight em nome de outra nem criar um
-- insight de plataforma.
ALTER TABLE agent_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_insights FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_insights' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON agent_insights
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
