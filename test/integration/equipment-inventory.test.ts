// Integration tests para as migrações 043 (manutenção de equipamento) e 044
// (inventário por clínica + fornecedores). Run com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as getMaintenance, POST as postMaintenance } from '../../app/api/equipment/[id]/maintenance/route.ts';
import { POST as postEquipment } from '../../app/api/equipment/route.ts';
import { GET as getSettings, PUT as putSettings } from '../../app/api/inventory/settings/route.ts';
import { POST as postItem } from '../../app/api/inventory/items/route.ts';
import { POST as postSupplier } from '../../app/api/suppliers/route.ts';
import { computeEquipmentOverview } from '../../lib/equipment.ts';
import { query } from '../../lib/db.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId, getTenantBId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let adminB: TestUser;
let tenantAId: string;
let tenantBId: string;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  adminB = await getSeededUser('admin.b@tenantb.test');
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
});

after(closeTestDb);

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function createEquipment(overrides: Record<string, unknown> = {}) {
  const res = await postEquipment(
    authedRequest(adminB, {
      method: 'POST',
      url: '/api/equipment',
      body: { name: `Autoclave ${uniq()}`, chair: 1, tags: ['esterilizacao'], ...overrides },
    }),
  );
  assert.equal(res.status, 201, 'equipamento de teste criado');
  return res.json();
}

test('manutenção: registar uma intervenção adianta o relógio da próxima revisão', async () => {
  const eq = await createEquipment();
  await query(`UPDATE clinic_equipment SET service_interval_days=90, last_serviced_at='2020-01-01' WHERE id=$1`, [
    eq.id,
  ]);

  const antes = (await computeEquipmentOverview(tenantBId)).find((e) => e.id === eq.id);
  assert.equal(antes?.serviceState, 'overdue', 'começa vencido');

  const hoje = new Date().toLocaleDateString('en-CA');
  const res = await postMaintenance(
    authedRequest(adminB, {
      method: 'POST',
      url: `/api/equipment/${eq.id}/maintenance`,
      body: { servicedAt: hoje, kind: 'preventive', technician: 'Téc. Silva', cost: 120, notes: 'Revisão anual' },
    }),
    { params: Promise.resolve({ id: eq.id }) },
  );
  assert.equal(res.status, 201);

  const depois = (await computeEquipmentOverview(tenantBId)).find((e) => e.id === eq.id);
  assert.equal(depois?.serviceState, 'ok', 'deixa de estar vencido');
  assert.equal(depois?.lastServicedAt, hoje);
  assert.equal(depois?.servicesLogged, 1, 'a intervenção fica no histórico');
});

test('manutenção: uma intervenção antiga não recua a data da última assistência', async () => {
  const eq = await createEquipment();
  const hoje = new Date().toLocaleDateString('en-CA');
  await postMaintenance(
    authedRequest(adminB, {
      method: 'POST',
      url: `/api/equipment/${eq.id}/maintenance`,
      body: { servicedAt: hoje, kind: 'preventive' },
    }),
    { params: Promise.resolve({ id: eq.id }) },
  );

  // Alguém a lançar histórico atrasado não pode fazer o equipamento parecer mais velho.
  await postMaintenance(
    authedRequest(adminB, {
      method: 'POST',
      url: `/api/equipment/${eq.id}/maintenance`,
      body: { servicedAt: '2021-05-05', kind: 'inspection' },
    }),
    { params: Promise.resolve({ id: eq.id }) },
  );

  const [row] = await query(`SELECT last_serviced_at::text AS d FROM clinic_equipment WHERE id=$1`, [eq.id]);
  assert.equal(row.d, hoje, 'mantém a data mais recente');

  const hist = await getMaintenance(
    authedRequest(adminB, { method: 'GET', url: `/api/equipment/${eq.id}/maintenance` }),
    { params: Promise.resolve({ id: eq.id }) },
  );
  const body = await hist.json();
  assert.equal(body.history.length, 2, 'mas guarda as duas intervenções');
});

test('manutenção: pode marcar o equipamento como avariado, e isso tira-o de disponível', async () => {
  const eq = await createEquipment();
  await postMaintenance(
    authedRequest(adminB, {
      method: 'POST',
      url: `/api/equipment/${eq.id}/maintenance`,
      body: { servicedAt: new Date().toLocaleDateString('en-CA'), kind: 'corrective', setStatus: 'broken' },
    }),
    { params: Promise.resolve({ id: eq.id }) },
  );

  const depois = (await computeEquipmentOverview(tenantBId)).find((e) => e.id === eq.id);
  assert.equal(depois?.status, 'broken');
  assert.equal(depois?.available, false, 'deixa de contar para a agenda');
});

test('manutenção: custo inválido é recusado com 400', async () => {
  const eq = await createEquipment();
  const res = await postMaintenance(
    authedRequest(adminB, {
      method: 'POST',
      url: `/api/equipment/${eq.id}/maintenance`,
      body: { servicedAt: '2026-01-01', cost: 'muito caro' },
    }),
    { params: Promise.resolve({ id: eq.id }) },
  );
  assert.equal(res.status, 400);
});

test('manutenção: equipamento de outra clínica devolve 404, não os dados', async () => {
  const eq = await createEquipment();
  const res = await getMaintenance(
    // superAdmin não tem tenant próprio; usa-se um admin de clínica diferente da dona.
    authedRequest(adminB, { method: 'GET', url: `/api/equipment/${eq.id}/maintenance` }),
    { params: Promise.resolve({ id: eq.id }) },
  );
  assert.equal(res.status, 200, 'a dona vê');

  const [outro] = await query(`SELECT id FROM clinic_equipment WHERE tenant_id=$1 LIMIT 1`, [tenantAId]);
  if (outro) {
    const alheio = await getMaintenance(
      authedRequest(adminB, { method: 'GET', url: `/api/equipment/${outro.id}/maintenance` }),
      { params: Promise.resolve({ id: String(outro.id) }) },
    );
    assert.equal(alheio.status, 404, 'a de outra clínica não');
  }
});

test('inventário: cada clínica tem o seu ponto de reposição sobre o catálogo partilhado', async () => {
  const itemRes = await postItem(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/items',
      body: { item: `Luvas ${uniq()}`, unit: 'cx', reorderAt: 10 },
    }),
  );
  assert.equal(itemRes.status, 201);
  const item = await itemRes.json();

  const res = await putSettings(
    authedRequest(adminB, {
      method: 'PUT',
      url: '/api/inventory/settings',
      body: { itemId: item.id, reorderAt: 40 },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 200);

  const listB = await getSettings(authedRequest(adminB, { method: 'GET', url: '/api/inventory/settings' }), {
    params: Promise.resolve({}),
  });
  const rowsB = await listB.json();
  const linha = rowsB.find((r: { item_id: number }) => r.item_id === item.id);
  assert.equal(Number(linha.global_reorder_at), 10, 'o catálogo global não muda');
  assert.equal(Number(linha.effective_reorder_at), 40, 'a clínica passa a usar o seu');

  // A clínica A continua no valor global — o override é só de quem o definiu.
  const [semOverride] = await query(
    `SELECT COALESCE(s.reorder_at, i.reorder_at) AS eff
       FROM inventory_items i
       LEFT JOIN inventory_item_settings s ON s.item_id=i.id AND s.tenant_id=$1
      WHERE i.id=$2`,
    [tenantAId, item.id],
  );
  assert.equal(Number(semOverride.eff), 10, 'a outra clínica não foi afetada');
});

test('fornecedores: nome duplicado na mesma clínica é recusado com mensagem legível', async () => {
  const nome = `Dental Supplies ${uniq()}`;
  const primeiro = await postSupplier(
    authedRequest(adminB, { method: 'POST', url: '/api/suppliers', body: { name: nome, email: 'a@b.pt' } }),
    { params: Promise.resolve({}) },
  );
  assert.equal(primeiro.status, 201);

  const repetido = await postSupplier(
    authedRequest(adminB, { method: 'POST', url: '/api/suppliers', body: { name: nome.toUpperCase() } }),
    { params: Promise.resolve({}) },
  );
  assert.equal(repetido.status, 400, 'não deixa duplicar, nem com outra capitalização');
});

test('fornecedores: sem nome é recusado', async () => {
  const res = await postSupplier(
    authedRequest(adminB, { method: 'POST', url: '/api/suppliers', body: { email: 'sem@nome.pt' } }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 400);
});
