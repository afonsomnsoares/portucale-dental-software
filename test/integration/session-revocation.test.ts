// Terminar sessão passou a terminar a sessão. Até à migração 064, POST /api/auth/logout
// apagava o cookie e mais nada: o token continuava assinado, dentro da validade e aceite
// por todas as rotas durante o que lhe faltasse de JWT_TTL_SECONDS — 7 dias por omissão.
// Uma cópia feita antes do clique valia uma semana.
//
// Estes testes fixam as duas metades: o token que fez logout deixa de valer, e SÓ esse.
//
// Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { POST as logout } from '../../app/api/auth/logout/route.ts';
import { GET as getSuppliers } from '../../app/api/suppliers/route.ts';
import { signToken } from '../../lib/auth.ts';
import { query } from '../../lib/db.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

// Utilizador só deste ficheiro: `node --test` corre cada ficheiro no seu processo e em
// paralelo com os outros, e revogar sessões de um utilizador do seed partiria as
// outras suites a meio. Mesmo raciocínio de session-revalidation.test.ts.
const EMAIL = 'revogacao@portucale.test';

let user: { id: string; name: string; role: string; clinic: string; tenantId: string };

// ─── Porque é que isto não usa o authedRequest ──────────────────────────────
// O helper assina um token NOVO a cada chamada, o que é exatamente o que não serve
// aqui: a revogação é por `jti`, e dois tokens do mesmo utilizador têm `jti` diferentes.
// Um teste que usasse o helper estaria sempre a apresentar um token que nunca fez
// logout — e passaria mesmo que a revogação não existisse.
function requestWithToken(token: string, opts: { method?: string; url: string }) {
  const csrf = crypto.randomUUID();
  const headers = new Headers({
    cookie: `dent_token=${token}; dent_csrf=${csrf}`,
    'x-csrf-token': csrf,
  });
  // biome-ignore lint/suspicious/noExplicitAny: os handlers só usam .headers/.url/.method/.json — ver test/helpers/authedRequest.ts
  return new Request(`http://localhost${opts.url}`, { method: opts.method || 'GET', headers }) as any;
}

function tokenFor() {
  return signToken({
    id: user.id,
    name: user.name,
    role: user.role,
    clinic: user.clinic,
    tenantId: user.tenantId,
  });
}

// 'inventory:manage' — admin tem por omissão. Serve de sonda para "este token ainda vale".
async function readSuppliers(token: string) {
  return getSuppliers(requestWithToken(token, { url: '/api/suppliers' }), { params: Promise.resolve({}) });
}

// ─── Porque é que não se afirma o status do logout ──────────────────────────
// Estes testes chamam os handlers diretamente, sem servidor (ver test/integration/README),
// e o `cookies()` de next/headers exige o escopo de um pedido real do Next — fora dele
// lança. O logout apaga o cookie por essa via, portanto aqui devolve sempre 500, em
// produção não. É limitação do arnês, não do código.
//
// O que importa é que a REVOGAÇÃO acontece na mesma, e acontece ANTES: `revokeSession`
// corre como primeira instrução do handler, precisamente porque é a parte que não pode
// deixar de acontecer. Um logout que falhe a apagar o cookie deixa uma sessão já morta
// num browser; a ordem inversa deixaria um token vivo em todo o lado.
//
// É por isso que estes testes afirmam o EFEITO — o token deixou de ser aceite — e não o
// estado HTTP. Afirmar o 500 seria fixar a limitação do arnês como se fosse a regra.
async function logoutWith(token: string) {
  await logout(requestWithToken(token, { method: 'POST', url: '/api/auth/logout' }), {
    params: Promise.resolve({}),
  });
}

before(async () => {
  await ensureSeeded();
  const tenantAId = await getTenantAId();
  const [row] = await query(
    `INSERT INTO users (email, password, name, role, clinic, tenant_id, active)
     VALUES ($1, 'x-sem-login-neste-teste', 'Revogação (teste)', 'admin', 'Clínica Portucale', $2, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET role='admin', tenant_id=EXCLUDED.tenant_id, active=TRUE
     RETURNING id, name, role, clinic, tenant_id`,
    [EMAIL, tenantAId],
  );
  user = { id: row.id, name: row.name, role: row.role, clinic: row.clinic, tenantId: row.tenant_id };
});

after(async () => {
  await query(`DELETE FROM revoked_sessions WHERE user_id=$1`, [user.id]);
  await query(`DELETE FROM users WHERE email=$1`, [EMAIL]);
  await closeTestDb();
});

test('linha de base: um token acabado de assinar passa', async () => {
  const res = await readSuppliers(tokenFor());
  assert.equal(res.status, 200);
});

test('depois do logout, o MESMO token deixa de ser aceite', async () => {
  const token = tokenFor();
  // Vale antes.
  assert.equal((await readSuppliers(token)).status, 200);

  await logoutWith(token);

  // E não vale depois. É este o comportamento que não existia: a assinatura continua
  // boa e o `exp` continua longe — o que mudou é que a sessão foi terminada.
  //
  // 401 e não 403: a sessão acabou, não é uma falta de permissão. É o que manda a
  // interface de volta ao ecrã de entrada em vez de mostrar «não tem permissão».
  assert.equal((await readSuppliers(token)).status, 401);
});

test('o logout revoga UM token, não a pessoa', async () => {
  // Duas sessões da mesma pessoa: o portátil da receção e o tablet do gabinete.
  const recepcao = tokenFor();
  const tablet = tokenFor();
  assert.notEqual(recepcao, tablet, 'dois tokens do mesmo utilizador têm de ser distintos');

  await logoutWith(recepcao);

  assert.equal((await readSuppliers(recepcao)).status, 401, 'o token que fez logout morre');
  // A alternativa barata (uma data por utilizador) faria esta linha falhar: terminar
  // sessão no balcão expulsaria a mesma pessoa do tablet, que não foi o que ela pediu.
  assert.equal((await readSuppliers(tablet)).status, 200, 'as outras sessões da mesma pessoa ficam de pé');
});

test('o logout é idempotente — o duplo-clique não duplica nem estoira', async () => {
  const token = tokenFor();
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  await logoutWith(token);
  await logoutWith(token);
  // Uma linha, não duas: é o ON CONFLICT DO NOTHING a tratar do duplo-clique, que numa
  // ligação lenta é o que acontece de facto.
  const rows = await query(`SELECT 1 FROM revoked_sessions WHERE jti=$1`, [payload.jti]);
  assert.equal(rows.length, 1);
});

test('a revogação guarda o exp do token, para a varredura o poder apagar sem reabrir nada', async () => {
  const token = tokenFor();
  await logoutWith(token);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const [row] = await query(
    `SELECT EXTRACT(EPOCH FROM expires_at)::bigint AS exp FROM revoked_sessions WHERE jti=$1`,
    [payload.jti],
  );
  assert.ok(row, 'a linha de revogação existe, indexada pelo jti do token');
  // O mesmo instante que o token declara: a linha deixa de ser precisa exatamente
  // quando o token passa a ser recusado por ter expirado.
  assert.equal(Number(row.exp), Number(payload.exp));
});
