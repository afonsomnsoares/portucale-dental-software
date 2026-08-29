// Integration tests for app/api/users. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PUT as putUser } from '../../app/api/users/[id]/route.ts';
import { GET as getUsers, POST as postUsers } from '../../app/api/users/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let receptionistA: TestUser;
let adminB: TestUser;
let tenantAId: string;
let tenantBId: string;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  receptionistA = await getSeededUser('rececao@portucale.dental');
  adminB = await getSeededUser('admin.b@tenantb.test');
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
});

after(closeTestDb);

test('caminho feliz: super-admin cria um novo utilizador', async () => {
  const res = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `novo.${Date.now()}@portucale.dental`,
        password: 'palavra-passe-longa',
        name: 'Novo Rececionista',
        role: 'receptionist',
        tenantId: tenantAId,
      },
    }),
  );
  assert.equal(res.status, 201);
});

test('não-admin recebe 403 em GET e POST /api/users', async () => {
  const getRes = await getUsers(authedRequest(receptionistA, { method: 'GET', url: '/api/users' }));
  assert.equal(getRes.status, 403);

  const postRes = await postUsers(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/users',
      body: { email: 'x@x.com', password: 'palavra-passe-longa', name: 'X', role: 'receptionist' },
    }),
  );
  assert.equal(postRes.status, 403);
});

test('admin de clínica não consegue criar utilizador noutro tenant', async () => {
  const res = await postUsers(
    authedRequest(adminB, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `cross.${Date.now()}@tenantb.test`,
        password: 'palavra-passe-longa',
        name: 'Cross Tenant',
        role: 'receptionist',
        tenantId: tenantAId,
      },
    }),
  );
  assert.equal(res.status, 403);
});

test('admin de clínica não consegue editar utilizador de outro tenant', async () => {
  const res = await putUser(
    authedRequest(adminB, {
      method: 'PUT',
      url: `/api/users/${receptionistA.id}`,
      body: { email: 'rececao@portucale.dental', name: 'Hack', role: 'receptionist' },
    }),
    { params: Promise.resolve({ id: receptionistA.id }) },
  );
  assert.equal(res.status, 403);
});

test('fix aplicado: admin de clínica só vê utilizadores do seu próprio tenant em GET /api/users', async () => {
  const res = await getUsers(authedRequest(adminB, { method: 'GET', url: '/api/users' }));
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length > 0, 'devia ver pelo menos o seu próprio admin');
  for (const row of rows) {
    assert.equal(row.tenant_id, tenantBId, `utilizador ${row.email} não pertence ao Tenant B — vazamento cross-tenant`);
  }
});

test('super-admin continua a ver utilizadores de todos os tenants em GET /api/users', async () => {
  const res = await getUsers(authedRequest(superAdmin, { method: 'GET', url: '/api/users' }));
  assert.equal(res.status, 200);
  const rows = await res.json();
  const tenantIds = new Set(rows.map((r: { tenant_id: string | null }) => r.tenant_id));
  assert.ok(tenantIds.has(tenantAId) && tenantIds.has(tenantBId), 'super-admin devia ver utilizadores de vários tenants');
});
