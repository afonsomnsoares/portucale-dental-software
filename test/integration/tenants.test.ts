// Integration tests for app/api/tenants. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getTenants, POST as postTenants } from '../../app/api/tenants/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let adminB: TestUser;
let receptionistA: TestUser;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  adminB = await getSeededUser('admin.b@tenantb.test');
  receptionistA = await getSeededUser('rececao@portucale.dental');
});

after(closeTestDb);

test('caminho feliz: super-admin lista e cria clínicas', async () => {
  const listRes = await getTenants(authedRequest(superAdmin, { method: 'GET', url: '/api/tenants' }), { params: Promise.resolve({}) });
  assert.equal(listRes.status, 200);

  const createRes = await postTenants(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/tenants',
      body: { name: `Clínica Teste ${Date.now()}`, city: 'Porto', operatories: 2 },
    }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 201);
});

test('admin de clínica (role=admin mas com tenantId) recebe 403 — só super-admin gere clínicas', async () => {
  const listRes = await getTenants(authedRequest(adminB, { method: 'GET', url: '/api/tenants' }), { params: Promise.resolve({}) });
  assert.equal(listRes.status, 403);

  const createRes = await postTenants(
    authedRequest(adminB, { method: 'POST', url: '/api/tenants', body: { name: 'Não devia existir', city: 'X' } }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 403);
});

test('receptionist recebe 403', async () => {
  const res = await getTenants(authedRequest(receptionistA, { method: 'GET', url: '/api/tenants' }), { params: Promise.resolve({}) });
  assert.equal(res.status, 403);
});
