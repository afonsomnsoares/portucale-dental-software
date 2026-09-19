-- ─── HARDENING: terminar sessão passa a terminar a sessão ────────────────────
-- POST /api/auth/logout apagava o cookie e mais nada. O token continuava assinado,
-- dentro da validade e aceite por qualquer rota — durante JWT_TTL_SECONDS, que são
-- 7 dias por omissão. Apagar o cookie tira-o do browser de quem carregou no botão;
-- não tira valor nenhum ao token que já saiu dali.
--
-- Isso é o contrário do que a pessoa julga estar a fazer, e a diferença importa
-- exatamente no caso em que ela carrega no botão de propósito: um posto partilhado na
-- receção, um portátil emprestado, um separador aberto num computador que não é dela.
-- Uma cópia do cookie feita antes do logout continuava a valer uma semana.
--
-- ─── Porquê uma lista de tokens revogados, e não uma data por utilizador ─────
-- A alternativa barata era uma coluna `users.sessions_valid_from` carimbada no logout,
-- como a `password_changed_at` da migração 046. Mas o significado seria outro: um
-- dentista que termina sessão no posto da receção perderia ao mesmo tempo a sessão do
-- tablet do gabinete. Terminar sessão AQUI não é dizer "expulsa-me de todo o lado" —
-- e um sistema que faz mais do que lhe pediram é um sistema em que se confia menos.
--
-- Por isso a revogação é do TOKEN, pelo `jti` que o signToken já escrevia em cada um e
-- que ninguém lia. A revogação em massa continua a existir e continua a ser a da 046:
-- mudar a password expulsa toda a gente, que é o gesto que se faz quando há motivo.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  -- O `jti` do token (UUID gerado por signToken). TEXT e não UUID de propósito: o
  -- formato do identificador é do emissor, e esta tabela não tem opinião sobre ele.
  jti        TEXT PRIMARY KEY,
  -- Só para diagnóstico ("que sessões é que esta pessoa terminou?"). CASCADE porque
  -- uma linha de revogação de um utilizador apagado não protege nada: sem `users` não
  -- há sessão para conceder.
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  -- O `exp` do token revogado. Passado esse instante o token é recusado por ter
  -- expirado, e a linha deixa de ter função — é o que permite varrer a tabela sem
  -- nunca reabrir uma sessão. Ver sweepRevokedSessions em lib/jobsRunner.ts.
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A varredura apaga por `expires_at`; sem índice seria uma sequencial a cada passagem.
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions(expires_at);

-- ─── Sem tenant_id, e portanto sem RLS ───────────────────────────────────────
-- Mesma natureza de `rate_limit_counters`: é estado do sistema de autenticação, não de
-- nenhuma clínica. A consulta que a lê corre sob withSystemContext (lib/permissions.ts),
-- pelo mesmo motivo que a leitura de `users` na revalidação de sessão — a clínica é o
-- que ainda se está a descobrir. A view `tenant_tables_without_rls` não a apanha
-- justamente por não ter a coluna, que é a regra que essa view codifica.
--
-- O que a protege é o privilégio: `portucale_app` pode inserir e apagar aqui, e não há
-- rota que exponha o conteúdo. Uma linha desta tabela não revela nada — é um `jti`
-- opaco de um token que já não vale.

-- ─── O que isto NÃO cobre, e porquê está certo assim ─────────────────────────
-- O proxy (proxy.ts) corre no runtime Edge e não fala com o Postgres: ele verifica a
-- assinatura do token e mais nada. Um token revogado continua, portanto, a deixar
-- CARREGAR o esqueleto de /dashboard — e todas as chamadas à API que essa página faz
-- respondem 401, porque essas passam por lib/route.ts, que corre em Node.
--
-- Não é uma lacuna nova nem própria desta migração: é exatamente o que já acontecia
-- com uma conta desativada e com a mudança de password da 046. A fronteira é a mesma e
-- é a que importa — o que protege dados é quem serve dados. Fechá-la no Edge exigiria
-- um armazenamento que o Edge alcance (Redis/Upstash), que é a mesma dependência que
-- lib/rateLimit.ts nomeia para o seu próprio limite.
