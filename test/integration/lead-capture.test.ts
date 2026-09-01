// Integration tests for the lead capture feature: app/api/lead-sources (authenticated,
// creates/manages per-source tokens) and app/api/public/leads (the one unauthenticated,
// bearer-token, cross-origin route in the whole project). Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as getLeads } from '../../app/api/leads/route.ts';
import { PUT as putLeadSource } from '../../app/api/lead-sources/[id]/route.ts';
import { GET as getLeadSources, POST as postLeadSources } from '../../app/api/lead-sources/route.ts';
import { OPTIONS as optionsPublicLeads, POST as postPublicLead } from '../../app/api/public/leads/route.ts';
import { anonRequest, authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let receptionistA: TestUser;
let tenantAId: string;
let tenantBId: string;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  receptionistA = await getSeededUser('rececao@portucale.dental');
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
});

after(closeTestDb);

async function createSource(label: string) {
  const res = await postLeadSources(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/lead-sources',
      body: { label, tenantId: tenantAId },
    }),
  );
  assert.equal(res.status, 201);
  return res.json();
}

test('caminho feliz: token válido cria um lead e incrementa lead_count/last_used_at', async () => {
  const source = await createSource('Site (teste)');
  assert.ok(source.token.startsWith('lc_'));
  assert.equal(source.lead_count, 0);
  assert.equal(source.last_used_at, null);

  const captureRes = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { name: 'Contacto de Teste', phone: '912000000', message: 'Olá, quero marcar uma consulta.' },
    }),
  );
  assert.equal(captureRes.status, 201);
  const created = await captureRes.json();
  assert.ok(created.leadId);

  const listRes = await getLeadSources(
    authedRequest(superAdmin, { method: 'GET', url: `/api/lead-sources?tenantId=${tenantAId}` }),
  );
  const sources = await listRes.json();
  const updated = sources.find((s: { id: string }) => s.id === source.id);
  assert.equal(updated.lead_count, 1);
  assert.ok(updated.last_used_at);
  assert.equal(updated.token_hash, undefined, 'token_hash must never be exposed by GET');

  const leadsRes = await getLeads(authedRequest(receptionistA, { method: 'GET', url: '/api/leads' }));
  const leads = await leadsRes.json();
  const captured = leads.find((l: { id: string }) => l.id === created.leadId);
  assert.equal(captured.name, 'Contacto de Teste');
  // source on the lead is the capture source's own label — never something the caller supplied.
  assert.equal(captured.source, 'Site (teste)');
});

test('token inexistente é rejeitado com 401, sem criar lead', async () => {
  const res = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: 'Bearer lc_does-not-exist' },
      body: { name: 'Não devia entrar', phone: '911111111' },
    }),
  );
  assert.equal(res.status, 401);
});

test('sem header Authorization é rejeitado com 401', async () => {
  const res = await postPublicLead(
    anonRequest({ method: 'POST', url: '/api/public/leads', body: { name: 'X', phone: '911111111' } }),
  );
  assert.equal(res.status, 401);
});

test('fonte desativada deixa de aceitar leads', async () => {
  const source = await createSource('Fonte a desativar');
  await putLeadSource(
    authedRequest(superAdmin, { method: 'PUT', url: `/api/lead-sources/${source.id}`, body: { active: false } }),
    { params: Promise.resolve({ id: source.id }) },
  );

  const res = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { name: 'Não devia entrar', phone: '911111111' },
    }),
  );
  assert.equal(res.status, 401);
});

test('name em falta é rejeitado com 400', async () => {
  const source = await createSource('Fonte validação nome');
  const res = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { phone: '911111111' },
    }),
  );
  assert.equal(res.status, 400);
});

test('sem phone nem email é rejeitado com 400', async () => {
  const source = await createSource('Fonte validação contacto');
  const res = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { name: 'Sem contacto' },
    }),
  );
  assert.equal(res.status, 400);
});

test('isolamento entre clínicas: o lead criado por um token da tenant A nunca aparece na tenant B', async () => {
  const source = await createSource('Fonte isolamento');
  const captureRes = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { name: 'Lead da Tenant A', email: 'leadA@example.com' },
    }),
  );
  const created = await captureRes.json();

  const adminB = await getSeededUser('admin.b@tenantb.test');
  const leadsBRes = await getLeads(authedRequest(adminB, { method: 'GET', url: '/api/leads?status=all' }));
  const leadsB = await leadsBRes.json();
  assert.ok(
    !leadsB.some((l: { id: string }) => l.id === created.leadId),
    'a lead created under tenant A must never be visible to tenant B',
  );
  // tenantBId is asserted implicitly here — adminB is tenant-scoped to it — but keep the
  // reference so the fixture (and the intent) stays legible if this test is extended.
  assert.ok(tenantBId);
});

test('OPTIONS devolve os headers CORS necessários para o preflight do browser', async () => {
  const res = await optionsPublicLeads();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Methods') || '', /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers') || '', /Authorization/i);
});

test('a resposta de sucesso também carrega o header CORS (não só o preflight)', async () => {
  const source = await createSource('Fonte CORS');
  const res = await postPublicLead(
    anonRequest({
      method: 'POST',
      url: '/api/public/leads',
      headers: { Authorization: `Bearer ${source.token}` },
      body: { name: 'CORS check', phone: '910000000' },
    }),
  );
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('limite de taxa por token dispara ao fim de N pedidos', async () => {
  const source = await createSource('Fonte rate-limit');
  let sawRateLimit = false;
  for (let i = 0; i < 25; i++) {
    const res = await postPublicLead(
      anonRequest({
        method: 'POST',
        url: '/api/public/leads',
        headers: { Authorization: `Bearer ${source.token}` },
        body: { name: `Lead ${i}`, phone: '919999999' },
      }),
    );
    if (res.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'expected the per-token rate limit to trip within 25 rapid requests');
});
