// Integration tests for app/api/audit. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getAudit } from '../../app/api/audit/route.ts';
import { appendAudit } from '../../lib/audit.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getOrCreateTenantAdmin,
  getSeededUser,
  getTenantAId,
  getTenantBId,
} from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

const CLINIC_A = 'Clínica Portucale';
const CLINIC_B = 'Tenant B (testes)';
const MARKER = `teste-audit-${Date.now()}`;

let superAdmin: TestUser;
let adminA: TestUser;
let receptionistA: TestUser;
let tenantAId: string;
let tenantBId: string;

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  superAdmin = await getSeededUser('admin@portucale.dental');
  receptionistA = await getSeededUser('rececao@portucale.dental');
  // Admin de clínica a sério, e não um JWT assinado sobre um UUID inventado: desde que
  // hasPermission() revalida a sessão contra a tabela `users` (lib/permissions.ts), um
  // token cujo `id` não corresponde a nenhuma linha ativa é recusado com 403 — que é
  // precisamente o ponto da revalidação, e por isso o stand-in sintético deixou de servir.
  adminA = await getOrCreateTenantAdmin(tenantAId, CLINIC_A);

  tenantBId = await getTenantBId();

  // `tenantId` passou a ser o que decide quem lê a linha — o `clinic` é só o rótulo
  // que aparece no ecrã. Ver scripts/migrations/056_audit_log_tenant_id.sql.
  await appendAudit(
    { name: 'Seed', role: 'admin', clinic: CLINIC_A, tenantId: tenantAId },
    'CREATE',
    MARKER,
    null,
    'x',
    CLINIC_A,
  );
  await appendAudit(
    { name: 'Seed', role: 'admin', clinic: CLINIC_B, tenantId: tenantBId },
    'CREATE',
    MARKER,
    null,
    'x',
    CLINIC_B,
  );
});

after(closeTestDb);

test('caminho feliz: super-admin lê o audit log e filtra por ação', async () => {
  const res = await getAudit(authedRequest(superAdmin, { method: 'GET', url: '/api/audit?action=CREATE' }), { params: Promise.resolve({}) });
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
   { params: Promise.resolve({}) });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length > 0, 'devia ver pelo menos a sua própria entrada');
  for (const row of rows as Array<{ clinic: string }>) {
    assert.equal(row.clinic, CLINIC_A, `admin do tenant A viu uma entrada da clínica "${row.clinic}"`);
  }
});

test('receptionist (role != admin) recebe 403', async () => {
  const res = await getAudit(authedRequest(receptionistA, { method: 'GET', url: '/api/audit' }), { params: Promise.resolve({}) });
  assert.equal(res.status, 403);
});

test('mudar o nome da própria clínica para o da clínica do lado não dá acesso a nada', async () => {
  // Este era o ataque: `clinic` é texto livre, um admin podia pôr lá o nome da outra
  // clínica (PUT /api/users/<próprio id>) e passar a ler o registo dela. Agora o
  // filtro é por tenant_id e o rótulo não decide nada.
  const impostor: TestUser = { ...adminA, clinic: CLINIC_B };

  const res = await getAudit(
    authedRequest(impostor, { method: 'GET', url: `/api/audit?q=${encodeURIComponent(MARKER)}` }),
    { params: Promise.resolve({}) },
  );

  assert.equal(res.status, 200);
  const rows = (await res.json()) as Array<{ clinic: string }>;
  for (const row of rows) {
    assert.equal(row.clinic, CLINIC_A, `o rótulo "${row.clinic}" passou a fronteira`);
  }
});

test('duas clínicas com o MESMO nome não se veem uma à outra', async () => {
  // O caso que não precisava de atacante nenhum: `clinic` vinha por omissão a
  // 'Main'/'Main Clinic', por isso duas clínicas acabadas de criar partilhavam rótulo
  // e liam o registo uma da outra.
  const COLIDE = 'Main Clinic';
  const marker = `teste-colisao-${Date.now()}`;

  await appendAudit(
    { name: 'A', role: 'admin', clinic: COLIDE, tenantId: tenantAId },
    'CREATE',
    marker,
    null,
    'x',
    COLIDE,
  );
  await appendAudit(
    { name: 'B', role: 'admin', clinic: COLIDE, tenantId: tenantBId },
    'CREATE',
    marker,
    null,
    'x',
    COLIDE,
  );

  const res = await getAudit(
    authedRequest({ ...adminA, clinic: COLIDE }, { method: 'GET', url: `/api/audit?q=${encodeURIComponent(marker)}` }),
    { params: Promise.resolve({}) },
  );

  assert.equal(res.status, 200);
  const rows = (await res.json()) as Array<{ user_name: string }>;
  assert.ok(rows.length > 0, 'o admin A devia continuar a ver a sua própria linha');
  for (const row of rows) {
    assert.equal(row.user_name, 'A', 'viu uma linha da clínica B com o mesmo rótulo');
  }
});

test('uma recusa sem sessão continua a ser registada — tenant_id NULL é aceite', async () => {
  // A política de INSERT aceita tenant_id NULL de propósito: logBlockedAccess()
  // regista tentativas anónimas, e essas nunca têm contexto de tenant. Se a política
  // as recusasse, o produto deixava de registar exatamente o que interessa.
  const { logBlockedAccess } = await import('../../lib/audit.ts');
  const reason = `recusa-anonima-${Date.now()}`;

  await assert.doesNotReject(() => logBlockedAccess(null, reason));

  // E fica invisível a um admin de clínica: linha de plataforma, dono só o super-admin.
  const res = await getAudit(
    authedRequest(adminA, { method: 'GET', url: `/api/audit?q=${encodeURIComponent(reason)}` }),
    { params: Promise.resolve({}) },
  );
  const rows = (await res.json()) as unknown[];
  assert.equal(rows.length, 0, 'uma linha sem clínica não pertence a nenhuma clínica');
});
