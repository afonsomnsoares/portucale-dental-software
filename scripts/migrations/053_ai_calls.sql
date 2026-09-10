-- ─── ai_calls: o que a IA custou, e a quem ──────────────────────────────────
-- Os agentes chamam a Anthropic desde lib/agents/aiClient.ts e a resposta traz sempre
-- `usage.input_tokens` / `usage.output_tokens`. Até aqui esse número era lido pelo SDK,
-- devolvido ao processo e deitado fora — o que deixava a plataforma sem resposta para
-- as três perguntas que uma camada de agentes tem obrigação de saber responder: quanto
-- é que isto custa, que clínica é que o consome, e o que é que falha.
--
-- Não é uma tabela de "analytics". É a contabilidade de um custo variável que cresce
-- com o uso e que ninguém vê até chegar a fatura. Uma clínica que multiplique por dez
-- as chamadas tem de aparecer aqui no dia em que o faz, não no fim do mês.
--
-- ─── Porquê uma tabela e não o job_runs ─────────────────────────────────────
-- Uma passagem de jobs (uma linha de job_runs) pode fazer zero ou várias chamadas ao
-- modelo, e uma chamada pode falhar sem a passagem falhar — é precisamente esse o
-- desenho de callAgentTool, que devolve 'failed' e deixa o agente cair para a regra
-- fixa. Enfiar isto em job_runs.details perdia a granularidade que interessa e
-- misturava dois tempos de vida diferentes.
--
-- ─── O que NÃO vai aqui ─────────────────────────────────────────────────────
-- Nem o prompt nem a resposta. O payload que vai para o modelo leva factos de doentes
-- (leadAgent manda o texto do lead), e guardar uma segunda cópia disso numa tabela de
-- observabilidade seria criar um arquivo de dados pessoais que ninguém pediu e que o
-- RGPD teria de tratar. Guarda-se a CONTA: quem, quando, quanto, correu bem.
CREATE TABLE IF NOT EXISTS ai_calls (
  id            BIGSERIAL PRIMARY KEY,
  -- NULL = chamada de plataforma (o agente Grupo não pertence a nenhuma clínica),
  -- o mesmo caso que job_runs.tenant_id já previa desde a migração 038.
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  model         TEXT NOT NULL,
  -- 'ok' | 'failed' | 'unconfigured' — os três estados do AgentToolResult de
  -- lib/agents/aiClient.ts, sem tradução pelo meio. 'unconfigured' também se
  -- regista: saber que a IA está desligada numa clínica é informação, não silêncio.
  status        TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'unconfigured')),
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  -- Mensagem de erro quando falha. É erro de infraestrutura (rede, rate limit, schema
  -- da tool), nunca conteúdo do doente.
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A varredura normal é "as últimas N desta clínica" e "as últimas N deste agente".
CREATE INDEX IF NOT EXISTS idx_ai_calls_tenant_created ON ai_calls(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_agent_created ON ai_calls(agent, created_at DESC);
-- Índice parcial para a página de Falhas, mesmo raciocínio do idx_agent_insights_open.
CREATE INDEX IF NOT EXISTS idx_ai_calls_failed ON ai_calls(created_at DESC) WHERE status = 'failed';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Mesmo desenho de job_runs e agent_insights: cada clínica vê o seu consumo, o
-- super_admin vê a rede, e as linhas de plataforma (tenant_id NULL) são só dele.
ALTER TABLE ai_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_calls FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_calls' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ai_calls
      USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      )
      WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      );
  END IF;
END $$;
