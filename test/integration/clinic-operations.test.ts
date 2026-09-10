// Integration tests for item 12 (Operações da Clínica): checklists de abertura/fecho
// (app/api/checklist-templates, app/api/checklist-runs) and escalamento de incidentes
// (app/api/incidents). Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PUT as putTemplate } from '../../app/api/checklist-templates/[id]/route.ts';
import { GET as getTemplates, POST as postTemplate } from '../../app/api/checklist-templates/route.ts';
import { PUT as putRun } from '../../app/api/checklist-runs/[id]/route.ts';
import { GET as getRuns, POST as postRun } from '../../app/api/checklist-runs/route.ts';
import { PUT as putIncident } from '../../app/api/incidents/[id]/route.ts';
import { GET as getIncidents, POST as postIncident } from '../../app/api/incidents/route.ts';
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

async function createTemplate(name: string, items: string[] = ['Item 1', 'Item 2']) {
  const res = await postTemplate(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/checklist-templates',
      body: { name, type: 'opening', items, tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  return res.json();
}

test('checklist templates: super_admin cria, rececionista (sem permissão) é bloqueada com 403', async () => {
  const res = await postTemplate(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-templates',
      body: { name: 'Não devia criar', items: ['X'] },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 403);

  const template = await createTemplate('Abertura da manhã (teste)');
  assert.equal(template.items.length, 2);
  assert.equal(template.active, true);
});

test('checklist templates: GET é aberto a qualquer membro do tenant (sem permissão especial)', async () => {
  await createTemplate('Fecho da tarde (teste)');
  const res = await getTemplates(authedRequest(receptionistA, { method: 'GET', url: '/api/checklist-templates' }), { params: Promise.resolve({}) });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.some((t: { name: string }) => t.name === 'Fecho da tarde (teste)'));
});

test('checklist templates: item vazio é rejeitado com 400', async () => {
  const res = await postTemplate(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/checklist-templates',
      body: { name: 'Sem items', items: [], tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 400);
});

test('checklist runs: rececionista pode iniciar (auto-serviço) e o snapshot fica igual ao template no momento', async () => {
  const template = await createTemplate('Checklist para correr (teste)', ['Ligar luzes', 'Verificar agenda']);
  const res = await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.items.length, 2);
  assert.ok(run.items.every((i: { checked: boolean }) => i.checked === false));
  assert.equal(run.status, 'in_progress');
});

test('checklist runs: iniciar duas vezes o mesmo template no mesmo dia devolve 409', async () => {
  const template = await createTemplate('Checklist duplicada (teste)');
  const first = await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(first.status, 201);

  const second = await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(second.status, 409);
});

test('checklist runs: marcar todos os itens completa a run e regista quem marcou', async () => {
  const template = await createTemplate('Checklist a completar (teste)', ['A', 'B']);
  const runRes = await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });
  const run = await runRes.json();

  const afterFirst = await putRun(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/checklist-runs/${run.id}`,
      body: { index: 0, checked: true },
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  const firstRow = await afterFirst.json();
  assert.equal(firstRow.status, 'in_progress');
  assert.equal(firstRow.items[0].checkedByName, receptionistA.name);

  const afterSecond = await putRun(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/checklist-runs/${run.id}`,
      body: { index: 1, checked: true },
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  const secondRow = await afterSecond.json();
  assert.equal(secondRow.status, 'completed');
  assert.ok(secondRow.completed_at);
});

test('checklist runs: GET filtra por data e por tenant', async () => {
  const template = await createTemplate('Checklist filtro data (teste)');
  await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });

  const sameDay = await getRuns(
    authedRequest(receptionistA, { method: 'GET', url: '/api/checklist-runs?date=2026-08-31' }),
   { params: Promise.resolve({}) });
  const sameDayRows = await sameDay.json();
  assert.ok(sameDayRows.some((r: { template_id: string }) => r.template_id === template.id));

  const otherDay = await getRuns(
    authedRequest(receptionistA, { method: 'GET', url: '/api/checklist-runs?date=2026-01-01' }),
   { params: Promise.resolve({}) });
  const otherDayRows = await otherDay.json();
  assert.ok(!otherDayRows.some((r: { template_id: string }) => r.template_id === template.id));
});

test('incidentes: qualquer membro reporta (auto-serviço); só quem tem incidents:manage atribui/resolve', async () => {
  const reportRes = await postIncident(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/incidents',
      body: { title: 'Autoclave avariada (teste)', category: 'equipment', severity: 'high' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(reportRes.status, 201);
  const incident = await reportRes.json();
  assert.equal(incident.status, 'open');
  assert.equal(incident.reported_by_name, receptionistA.name);

  const blockedResolve = await putIncident(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/incidents/${incident.id}`,
      body: { status: 'resolved' },
    }),
    { params: Promise.resolve({ id: incident.id }) },
  );
  assert.equal(blockedResolve.status, 403, 'quem reportou não pode resolver sem incidents:manage');

  const resolveRes = await putIncident(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/incidents/${incident.id}`,
      body: { status: 'resolved', resolutionNotes: 'Peça substituída (teste)' },
    }),
    { params: Promise.resolve({ id: incident.id }) },
  );
  assert.equal(resolveRes.status, 200);
  const resolved = await resolveRes.json();
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolution_notes, 'Peça substituída (teste)');
  assert.ok(resolved.resolved_at);
});

test('incidentes: isolamento entre clínicas — um incidente da tenant A nunca aparece para a tenant B', async () => {
  const reportRes = await postIncident(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/incidents',
      body: { title: 'Incidente isolado (teste)' },
    }),
   { params: Promise.resolve({}) });
  const incident = await reportRes.json();

  const listB = await getIncidents(authedRequest(adminB, { method: 'GET', url: '/api/incidents?status=all' }), { params: Promise.resolve({}) });
  const rowsB = await listB.json();
  assert.ok(!rowsB.some((i: { id: string }) => i.id === incident.id));
  assert.ok(tenantBId);

  // e adminB não consegue geri-lo por id, mesmo que soubesse o id
  const putRes = await putIncident(
    authedRequest(adminB, { method: 'PUT', url: `/api/incidents/${incident.id}`, body: { status: 'resolved' } }),
    { params: Promise.resolve({ id: incident.id }) },
  );
  assert.equal(putRes.status, 404);
});

test('checklist templates: desativar (active:false) impede novas runs mas não apaga o template', async () => {
  const template = await createTemplate('Checklist a desativar (teste)');
  const deactivate = await putTemplate(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/checklist-templates/${template.id}`,
      body: { active: false },
    }),
    { params: Promise.resolve({ id: template.id }) },
  );
  assert.equal(deactivate.status, 200);
  assert.equal((await deactivate.json()).active, false);

  const runRes = await postRun(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/checklist-runs',
      body: { templateId: template.id, runDate: '2026-08-31' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(runRes.status, 404);
});
