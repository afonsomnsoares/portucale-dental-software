// Integration tests for app/api/audit. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GET as getAudit } from '../../app/api/audit/route.ts';
import { appendAudit } from '../../lib/audit.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

const CLINIC_A = 'Clínica Portucale';
const CLINIC_B = 'Tenant B (testes)';
const MARKER = `teste-audit-${Date.now()}`;

let superAdmin: TestUser;
let adminA: TestUser;
let receptionistA: TestUser;

before(async () => {
  await ensureSeeded();
  const tenantAId = await getTenantAId();
  superAdmin = await getSeededUser('admin@portucale.dental');
  receptionistA = await getSeededUser('rececao@portucale.dental');
  // Synthetic tenant-scoped admin: getAuth() only decodes the signed JWT's claims
  // (role/tenantId/clinic) — none of these routes re-check the users table for identity —
  // so this is a faithful stand-in for "an admin belonging to tenant A" without needing to
  // seed one specifically.
  adminA = { id: crypto.randomUUID(), name: 'Admin A (teste)', role: 'admin', clinic: CLINIC_A, tenantId: tenantAId };

  await appendAudit({ name: 'Seed', role: 'admin', clinic: CLINIC_A }, 'CREATE', MARKER, null, 'x', CLINIC_A);
  await appendAudit({ name: 'Seed', role: 'admin', clinic: CLINIC_B }, 'CREATE', MARKER, null, 'x', CLINIC_B);
});

after(closeTestDb);

test('caminho feliz: super-admin lê o audit log e filtra por ação', async () => {
  const res = await getAudit(authedRequest(superAdmin, { method: 'GET', url: '/api/audit?action=CREATE' }));
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.some((r: { resource: string; clinic: string }) => r.resource === MARKER && r.clinic === CLINIC_A));
  assert.ok(rows.some((r: { resource: string; clinic: string }) => r.resource === MARKER && r.clinic === CLINIC_B));
});

test('admin de clínica não vê audit log de outra clínica mesmo pedindo ?clinic= explícito', async () => {
  const res = await getAudit(
    authedRequest(adminA, {
      method: 'GET',
      url: `/api/audit?q=${encodeURIComponent(MARKER)}&clinic=${encodeURIComponent(CLINIC_B)}`,
    }),
  );
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length > 0, 'devia ver pelo menos a sua própria entrada');
  for (const row of rows as Array<{ clinic: string }>) {
    assert.equal(row.clinic, CLINIC_A, `admin do tenant A viu uma entrada da clínica "${row.clinic}"`);
  }
});

test('receptionist (role != admin) recebe 403', async () => {
  const res = await getAudit(authedRequest(receptionistA, { method: 'GET', url: '/api/audit' }));
  assert.equal(res.status, 403);
});
