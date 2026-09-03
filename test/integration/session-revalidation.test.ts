// O JWT vale 7 dias (JWT_TTL_SECONDS) e transporta `role` e `tenantId` congelados no
// momento em que foi assinado. Estes testes fixam que a autorização passou a seguir a
// base de dados e não o token: desativar uma conta, despromovê-la ou movê-la de clínica
// tem efeito no pedido seguinte, não daí a uma semana. Ver lib/permissions.ts.
//
// Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { GET as getSuppliers } from '../../app/api/suppliers/route.ts';
import { query } from '../../lib/db.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

// `node --test` corre cada ficheiro no seu próprio processo, em paralelo com os outros.
// Mexer no estado de um utilizador do seed (desativá-lo, mudar-lhe o papel) partiria as
// outras suites a meio — daí um utilizador só deste ficheiro, criado e apagado aqui.
const EMAIL = 'revalidacao@portucale.test';

let tenantAId: string;
let tenantBId: string;
let admin: TestUser;

// 'inventory:manage': admin tem por omissão, receptionist não (lib/permissions.ts). Serve
// de sonda para "que papel está a valer neste momento".
async function readSuppliers(as: TestUser) {
  return getSuppliers(authedRequest(as, { method: 'GET', url: '/api/suppliers' }), {
    params: Promise.resolve({}),
  });
}

async function setUser(fields: { active?: boolean; role?: string; tenantId?: string }) {
  await query(
    `UPDATE users
        SET active   = COALESCE($2, active),
            role     = COALESCE($3, role),
            tenant_id= COALESCE($4::uuid, tenant_id)
      WHERE email=$1`,
    [EMAIL, fields.active ?? null, fields.role ?? null, fields.tenantId ?? null],
  );
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
  const [row] = await query(
    `INSERT INTO users (email, password, name, role, clinic, tenant_id, active)
     VALUES ($1, 'x-sem-login-neste-teste', 'Revalidação (teste)', 'admin', 'Clínica Portucale', $2, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET role='admin', tenant_id=EXCLUDED.tenant_id, active=TRUE
     RETURNING id, name, role, clinic, tenant_id`,
    [EMAIL, tenantAId],
  );
  // O token é assinado UMA vez, aqui, com role=admin e tenant A. Nenhum teste abaixo o
  // volta a assinar — é esse o ponto: é sempre o mesmo cookie, o que muda é a base de dados.
  admin = { id: row.id, name: row.name, role: row.role, clinic: row.clinic, tenantId: row.tenant_id };
});

after(async () => {
  await query(`DELETE FROM users WHERE email=$1`, [EMAIL]);
  await closeTestDb();
});

test('linha de base: com a conta ativa e admin, o token passa', async () => {
  const res = await readSuppliers(admin);
  assert.equal(res.status, 200);
});

test('conta desativada é recusada no pedido seguinte, com o mesmo token', async () => {
  await setUser({ active: false });
  const res = await readSuppliers(admin);
  assert.equal(res.status, 403, 'uma conta desativada não devia poder usar um token ainda válido');
});

test('reativar devolve o acesso — a decisão é da base de dados, não do token', async () => {
  await setUser({ active: true });
  const res = await readSuppliers(admin);
  assert.equal(res.status, 200);
});

test('despromover manda mais do que o role assinado no JWT', async () => {
  await setUser({ role: 'receptionist' });
  // O token continua a dizer role=admin; a base de dados diz receptionist, que não tem
  // 'inventory:manage' por omissão.
  assert.equal(admin.role, 'admin', 'o token do teste tem mesmo de continuar a dizer admin');
  const res = await readSuppliers(admin);
  assert.equal(res.status, 403, 'a permissão devia seguir o papel na BD, não o do token');
  await setUser({ role: 'admin' });
});

test('utilizador apagado: um token bem assinado deixa de valer', async () => {
  const fantasma: TestUser = {
    id: crypto.randomUUID(),
    name: 'Já não existe',
    role: 'admin',
    clinic: 'Clínica Portucale',
    tenantId: tenantAId,
  };
  const res = await readSuppliers(fantasma);
  assert.equal(res.status, 403, 'um id que não corresponde a nenhuma linha de users não devia autorizar nada');
});

test('mudar de clínica reposiciona o contexto de tenant do pedido', async () => {
  // O token diz tenant A. A base de dados passa a dizer tenant B, e é B que tem de valer:
  // caso contrário a pessoa continuava a ler as linhas da clínica antiga durante o resto
  // do pedido, porque o contexto de RLS foi estabelecido a partir do token.
  const marker = `fornecedor-revalidacao-${Date.now()}`;
  await query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1,$2)`, [tenantBId, marker]);
  await setUser({ tenantId: tenantBId });

  const res = await readSuppliers(admin);
  assert.equal(res.status, 200);
  const rows = (await res.json()) as Array<{ tenant_id: string; name: string }>;
  assert.ok(
    rows.some((r) => r.name === marker),
    'devia ver os fornecedores da clínica onde a BD diz que está agora',
  );
  for (const r of rows) {
    assert.equal(r.tenant_id, tenantBId, 'não devia trazer nada da clínica que o token ainda nomeia');
  }

  await query(`DELETE FROM suppliers WHERE tenant_id=$1 AND name=$2`, [tenantBId, marker]);
  await setUser({ tenantId: tenantAId });
});
