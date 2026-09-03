-- ─── Contador de rate limit partilhado entre instâncias ──────────────────────
-- lib/rateLimit.ts guarda as contagens em `globalThis`, ou seja, na memória de um
-- processo. Com uma só instância isso está correto. Com duas atrás de um
-- balanceador, o travão do login deixa de ser um travão: cada instância tem o seu
-- balde de 10 tentativas, e quem anda a adivinhar passwords só precisa de calhar
-- noutra instância — coisa que um round-robin lhe dá de graça.
--
-- Esta tabela é o contador partilhado. Só a usam os limites que são CONTROLOS DE
-- SEGURANÇA (hoje: o login). O travão genérico de /api/* continua em memória de
-- propósito: corre no middleware Edge, que não fala com o Postgres, e é um teto
-- anti-abuso — N instâncias × 240 pedidos/minuto continua a ser um teto. Ver o
-- comentário no topo de lib/rateLimit.ts.
--
-- Sem `tenant_id` deliberadamente: o login acontece ANTES de existir sessão, por
-- isso não há clínica a que atribuir a contagem, e a chave é derivada do IP e do
-- email tentado. Não é dado de nenhuma clínica — é dado do sistema. Por isso
-- também não leva política de RLS (e a view `tenant_tables_without_rls` não a
-- apanha, porque não tem a coluna).

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count        INTEGER NOT NULL DEFAULT 0
);

-- Para a limpeza periódica varrer por janela em vez de fazer seq scan.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON rate_limit_counters(window_start);

-- O papel restrito precisa de escrever aqui: o limitador corre antes de haver
-- sessão, no mesmo processo que serve o pedido.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portucale_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_counters TO portucale_app;
  END IF;
END $$;
