-- ─── HARDENING: mudar a password invalida as sessões já emitidas ─────────────
-- lib/permissions.ts's revalidateSession já confronta o token com a base de dados a
-- cada verificação de permissão, e apanha três coisas: conta apagada, conta desativada
-- e mudança de papel/clínica. Não apanhava a quarta — a password ter sido mudada.
--
-- O que isso significava na prática: uma password comprometida podia ser trocada e o
-- token de quem a tinha roubado continuava a valer até expirar (JWT_TTL_SECONDS, 7 dias
-- por omissão). Trocar a password é precisamente o que uma pessoa faz quando desconfia
-- que alguém entrou na conta dela, e era a única das quatro situações em que isso não
-- expulsava ninguém. O remendo disponível até aqui era desativar a conta (active=FALSE),
-- que corta já — mas expulsa também o utilizador legítimo, e ninguém se lembra disso a
-- meio de um incidente.
--
-- Coluna + trigger, e não uma coluna que cada rota se lembre de escrever, porque hoje há
-- QUATRO caminhos que escrevem `users.password`: app/api/users/route.ts (criação),
-- app/api/users/[id]/route.ts (edição), scripts/create-admin.ts e scripts/seed.ts. Um
-- trigger cobre os quatro e cobre o quinto que alguém escrever para o ano — mesma lógica
-- da migração 016 (updated_at) e da 015 (cadeia de hash da auditoria): a regra vive na
-- base de dados, não na disciplina de quem chama.
--
-- NULL é o valor de repouso e significa "nunca mudada desde que esta coluna existe".
-- lib/permissions.ts trata NULL como "não invalida nada", por isso aplicar esta migração
-- a uma base já em uso não expulsa ninguém — só passa a contar a partir da próxima
-- mudança de password. É a leitura conservadora de propósito: uma migração de segurança
-- que termine todas as sessões abertas da clínica no meio de uma manhã de consultas é
-- uma migração que ninguém aplica.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Só dispara quando o hash muda de facto: `IS DISTINCT FROM` (e não `<>`) para que um
-- NULL de qualquer dos lados se comporte como comparação normal em vez de devolver NULL
-- e nunca disparar. Uma UPDATE que mexa no nome ou no papel não toca na coluna, portanto
-- não expulsa ninguém — o gatilho é a password, não a edição do utilizador.
CREATE OR REPLACE FUNCTION set_password_changed_at() RETURNS trigger AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    NEW.password_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotente (DROP + CREATE), como todos os triggers deste projeto.
DROP TRIGGER IF EXISTS trg_set_password_changed_at ON users;
CREATE TRIGGER trg_set_password_changed_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_password_changed_at();
