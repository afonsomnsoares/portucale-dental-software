// Integration tests para app/api/agent-insights — o que os agentes de análise escrevem
// (migração 041). O que interessa aqui é o isolamento: os insights do agente Grupo têm
// tenant_id NULL e NUNCA podem aparecer a uma clínica, e os de uma clínica nunca podem
// aparecer a outra. Run com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// Nota sobre os utilizadores: 'admin@portucale.dental' é super_admin (sem tenant), e a
// clínica A não tem admin próprio semeado — o admin de clínica que existe é o da B. Por
// isso a perspetiva "uma clínica" aqui é sempre a da B.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as getInsights, PATCH as patchInsight } from '../../app/api/agent-insights/route.ts';
import { query } from '../../lib/db.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let adminB: TestUser;
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
  await query(`DELETE FROM agent_insights`);
});

after(closeTestDb);

async function seedInsight(tenantId: string | null, agentId: string, title: string) {
  const [row] = await query(
    `INSERT INTO agent_insights (tenant_id, agent_id, kind, severity, title, body, impact_eur)
     VALUES ($1,$2,'revenue_drop','warning',$3,'corpo',100) RETURNING *`,
    [tenantId, agentId, title],
  );
  return row;
}

const asRows = async (res: Response) => {
  assert.equal(res.status, 200, `esperava 200, veio ${res.status}`);
  const rows = await res.json();
  assert.ok(Array.isArray(rows), 'a resposta tem de ser uma lista');
  return rows as Array<{ id: string; title: string }>;
};

test('isolamento: uma clínica não vê os insights de outra', async () => {
  await seedInsight(tenantAId, 'finance', 'Da clínica A');
  await seedInsight(tenantBId, 'finance', 'Da clínica B');

  const rows = await asRows(
    await getInsights(authedRequest(adminB, { method: 'GET', url: '/api/agent-insights' }), {
      params: Promise.resolve({}),
    }),
  );
  const titles = rows.map((r) => r.title);
  assert.ok(titles.includes('Da clínica B'));
  assert.ok(!titles.includes('Da clínica A'), 'o insight da outra clínica não pode aparecer');
});

test('o insight de plataforma (agente Grupo, tenant_id NULL) não aparece a uma clínica', async () => {
  await seedInsight(null, 'group', 'Comparação entre clínicas');

  const rows = await asRows(
    await getInsights(authedRequest(adminB, { method: 'GET', url: '/api/agent-insights' }), {
      params: Promise.resolve({}),
    }),
  );
  assert.ok(
    !rows.map((r) => r.title).includes('Comparação entre clínicas'),
    'uma clínica nunca lê o que o Grupo diz das outras',
  );
});

test('o super-admin sem clínica escolhida vê os insights de plataforma', async () => {
  const rows = await asRows(
    await getInsights(authedRequest(superAdmin, { method: 'GET', url: '/api/agent-insights' }), {
      params: Promise.resolve({}),
    }),
  );
  assert.ok(rows.map((r) => r.title).includes('Comparação entre clínicas'));
});

test('a rececionista não tem agents:read — recebe 403 em vez da lista', async () => {
  const res = await getInsights(authedRequest(receptionistA, { method: 'GET', url: '/api/agent-insights' }), {
    params: Promise.resolve({}),
  });
  assert.equal(res.status, 403);
});

test('marcar como tratado não apaga — guarda quem e quando', async () => {
  const insight = await seedInsight(tenantBId, 'management', 'Para tratar');

  const res = await patchInsight(
    authedRequest(adminB, { method: 'PATCH', url: '/api/agent-insights', body: { id: insight.id } }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 200);

  const [row] = await query(`SELECT resolved_at, resolved_by, title FROM agent_insights WHERE id=$1`, [insight.id]);
  assert.ok(row.resolved_at, 'fica marcado como tratado');
  assert.ok(row.resolved_by, 'guarda quem o fechou');
  assert.equal(row.title, 'Para tratar', 'a linha continua lá — não é apagada');
});

test('por omissão, o GET só devolve os que estão por tratar', async () => {
  const abertos = await asRows(
    await getInsights(authedRequest(adminB, { method: 'GET', url: '/api/agent-insights' }), {
      params: Promise.resolve({}),
    }),
  );
  assert.ok(!abertos.some((r) => r.title === 'Para tratar'));

  const todos = await asRows(
    await getInsights(authedRequest(adminB, { method: 'GET', url: '/api/agent-insights?includeResolved=1' }), {
      params: Promise.resolve({}),
    }),
  );
  assert.ok(todos.some((r) => r.title === 'Para tratar'));
});

test('PATCH com id inexistente devolve 404, não 500', async () => {
  const res = await patchInsight(
    authedRequest(adminB, {
      method: 'PATCH',
      url: '/api/agent-insights',
      body: { id: '00000000-0000-0000-0000-000000000000' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 404);
});
