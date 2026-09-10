// Integration tests for the super_admin / admin role split (scripts/migrations/017_super_admin_role.sql).
// Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PUT as putUser } from '../../app/api/users/[id]/route.ts';
import { GET as getUsers, POST as postUsers } from '../../app/api/users/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import { query } from '../../lib/db.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let adminB: TestUser; // clinic admin, tenant B — role='admin', tenant_id set
let receptionistA: TestUser;
let tenantAId: string;
let tenantBId: string;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  adminB = await getSeededUser('admin.b@tenantb.test');
  receptionistA = await getSeededUser('rececao@portucale.dental');
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
});

after(closeTestDb);

test('caminho feliz: super-admin cria um admin de clínica', async () => {
  const email = `novo.admin.${Date.now()}@portucale.dental`;
  const res = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email,
        password: 'palavra-passe-longa',
        name: 'Novo Admin de Clínica',
        role: 'admin',
        tenantId: tenantAId,
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.role, 'admin');
  assert.equal(created.tenant_id, tenantAId);
});

test('super-admin sem tenantId no corpo ao criar um admin recebe 400, não um erro de BD', async () => {
  const res = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `sem.tenant.${Date.now()}@portucale.dental`,
        password: 'palavra-passe-longa',
        name: 'Sem Tenant',
        role: 'admin',
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 400);
});

test('admin de clínica não consegue criar outro admin — só o super-admin pode', async () => {
  const res = await postUsers(
    authedRequest(adminB, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `peer.admin.${Date.now()}@tenantb.test`,
        password: 'palavra-passe-longa',
        name: 'Peer Admin',
        role: 'admin',
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 403);
});

test('ninguém cria um super_admin via POST /api/users, nem o próprio super-admin', async () => {
  const res = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `outro.super.${Date.now()}@portucale.dental`,
        password: 'palavra-passe-longa',
        name: 'Outro Super Admin',
        role: 'super_admin',
        tenantId: tenantAId,
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 400);
});

test('admin de clínica não consegue promover uma rececionista a admin', async () => {
  // adminB (tenant B) editing receptionistA (tenant A) would 403 on the cross-tenant
  // guard first — use a same-tenant target instead by creating one, then attempt the
  // promotion from a peer clinic admin (adminB is tenant B, so target must be tenant B).
  const created = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `staff.${Date.now()}@tenantb.test`,
        password: 'palavra-passe-longa',
        name: 'Staff Tenant B',
        role: 'receptionist',
        tenantId: tenantBId,
      },
    }),
   { params: Promise.resolve({}) }).then((r) => r.json());

  const res = await putUser(
    authedRequest(adminB, {
      method: 'PUT',
      url: `/api/users/${created.id}`,
      body: { email: created.email, name: created.name, role: 'admin' },
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(res.status, 400);
});

test('super-admin promove e depois despromove um admin de clínica com sucesso', async () => {
  const created = await postUsers(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/users',
      body: {
        email: `promovivel.${Date.now()}@tenantb.test`,
        password: 'palavra-passe-longa',
        name: 'Promovível',
        role: 'receptionist',
        tenantId: tenantBId,
      },
    }),
   { params: Promise.resolve({}) }).then((r) => r.json());

  const promoted = await putUser(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/users/${created.id}`,
      body: { email: created.email, name: created.name, role: 'admin', tenantId: tenantBId },
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).role, 'admin');

  const demoted = await putUser(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/users/${created.id}`,
      body: { email: created.email, name: created.name, role: 'receptionist', tenantId: tenantBId },
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(demoted.status, 200);
  assert.equal((await demoted.json()).role, 'receptionist');
});

test('ninguém consegue mudar o role para super_admin via PUT /api/users/[id]', async () => {
  const res = await putUser(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/users/${receptionistA.id}`,
      body: { email: 'rececao@portucale.dental', name: 'Rececionista', role: 'super_admin' },
    }),
    { params: Promise.resolve({ id: receptionistA.id }) },
  );
  assert.equal(res.status, 400);
});

test('GET /api/users continua acessível a um admin de clínica (não só ao super-admin)', async () => {
  const res = await getUsers(authedRequest(adminB, { method: 'GET', url: '/api/users' }), { params: Promise.resolve({}) });
  assert.equal(res.status, 200);
});

test('BD: users_role_tenant_consistency rejeita um role não-super_admin sem tenant_id', async () => {
  await assert.rejects(
    () =>
      query(`INSERT INTO users (email, password, name, role, clinic, tenant_id) VALUES ($1,$2,$3,$4,$5,NULL)`, [
        `orfao.${Date.now()}@teste.test`,
        'x',
        'Órfão',
        'dentist',
        'Tower',
      ]),
    /constraint|violat/i,
  );
});

test('BD: users_role_tenant_consistency rejeita um super_admin com tenant_id', async () => {
  await assert.rejects(
    () =>
      query(`INSERT INTO users (email, password, name, role, clinic, tenant_id) VALUES ($1,$2,$3,'super_admin',$4,$5)`, [
        `super.com.tenant.${Date.now()}@teste.test`,
        'x',
        'Super Com Tenant',
        'Tower',
        tenantAId,
      ]),
    /constraint|violat/i,
  );
});
