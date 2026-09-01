-- ─── LEADS: captação automática por token ─────────────────────────────────
-- app/api/leads/route.ts já existe (registo manual + conversão), mas não há
-- forma de um site externo, formulário embutido ou landing page criar um
-- lead sozinho — cada fonte de captação tem o seu próprio token opaco,
-- revogável independentemente das outras (uma clínica pode ter "Site" e
-- "Formulário X" ao mesmo tempo, e desativar um sem afetar o outro).
--
-- Só o hash SHA-256 do token fica gravado (token_hash) — o valor em claro é
-- gerado em app/api/lead-sources/route.ts e devolvido uma única vez na
-- resposta do POST; nunca é recuperável depois disso, o mesmo princípio de
-- uma password com bcrypt, aqui aplicado a um segredo do tipo "API key".
-- token_prefix guarda só os primeiros caracteres (não secreto) para a UI
-- conseguir distinguir fontes sem voltar a mostrar o token inteiro.
--
-- app/api/public/leads/route.ts é a única rota do projeto que lê esta
-- tabela sem sessão (via lib/db.ts's withSystemContext) — ver o comentário
-- nesse ficheiro para o modelo de segurança completo.
CREATE TABLE IF NOT EXISTS lead_capture_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  lead_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lead_capture_sources_tenant ON lead_capture_sources(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_capture_sources' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE lead_capture_sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lead_capture_sources FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON lead_capture_sources
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON lead_capture_sources;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON lead_capture_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
