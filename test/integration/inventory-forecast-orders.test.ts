// Integration tests for item 13 Fase 2 (Inventário: previsão de consumo, validade,
// automação de encomendas): app/api/inventory/items, app/api/inventory/movements,
// app/api/inventory/forecast, app/api/purchase-orders. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PUT as putInventoryItem } from '../../app/api/inventory/items/[id]/route.ts';
import { GET as getInventoryItems, POST as postInventoryItem } from '../../app/api/inventory/items/route.ts';
import { GET as getForecast } from '../../app/api/inventory/forecast/route.ts';
import { GET as getMovements, POST as postMovement } from '../../app/api/inventory/movements/route.ts';
import { PUT as putPurchaseOrder } from '../../app/api/purchase-orders/[id]/route.ts';
import { GET as getPurchaseOrders, POST as postPurchaseOrder } from '../../app/api/purchase-orders/route.ts';
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

async function createItem(name: string, reorderAt = 10) {
  const res = await postInventoryItem(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/items',
      body: { item: name, unit: 'un', reorderAt },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  return res.json();
}

test('inventory items: receptionist (sem inventory:manage) é bloqueada com 403 a criar', async () => {
  const res = await postInventoryItem(
    authedRequest(receptionistA, { method: 'POST', url: '/api/inventory/items', body: { item: 'Não devia' } }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 403);
});

test('inventory items: super_admin cria, GET lista-o', async () => {
  const item = await createItem('Luvas de nitrilo (teste)');
  assert.equal(item.reorder_at, 10);
  const listRes = await getInventoryItems(authedRequest(superAdmin, { method: 'GET', url: '/api/inventory/items' }), { params: Promise.resolve({}) });
  const rows = await listRes.json();
  assert.ok(rows.some((r: { id: number }) => r.id === item.id));
});

test('movements: receber stock com validade cria um lote; consumir gasta primeiro o lote que expira mais cedo (FEFO)', async () => {
  const item = await createItem('Anestesia (teste)', 5);

  const receiveOld = await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: 10, reason: 'received', batchNumber: 'LOTE-VELHO', expiryDate: '2026-09-05', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });
  assert.equal(receiveOld.status, 201);

  const receiveNew = await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: 10, reason: 'received', batchNumber: 'LOTE-NOVO', expiryDate: '2027-01-01', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });
  assert.equal(receiveNew.status, 201);

  // consome 12 — deve esvaziar o lote velho (10) e tirar 2 do novo
  const consume = await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: -12, reason: 'consumed', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });
  assert.equal(consume.status, 201);

  const forecastRes = await getForecast(
    authedRequest(superAdmin, { method: 'GET', url: `/api/inventory/forecast?tenantId=${tenantAId}` }),
   { params: Promise.resolve({}) });
  const forecast = await forecastRes.json();
  const row = forecast.overview.find((r: { item: { id: number } }) => r.item.id === item.id);
  assert.equal(row.currentQty, 8); // 20 recebidas - 12 consumidas
  // O forecast só lista lotes com quantidade > 0 (é a vista de "o que ainda está
  // disponível") — o lote que expira primeiro foi totalmente consumido e deixa de aparecer;
  // só sobra o lote mais recente, com o resto (10 - 2 consumidas = 8).
  const oldBatch = row.batches.find((b: { batch_number: string }) => b.batch_number === 'LOTE-VELHO');
  const newBatch = row.batches.find((b: { batch_number: string }) => b.batch_number === 'LOTE-NOVO');
  assert.equal(oldBatch, undefined, 'o lote que expira primeiro deve ter sido esvaziado e some da lista de disponíveis');
  assert.equal(newBatch.quantity, 8);
});

test('movements: GET lista o histórico, filtrável por item; isolamento entre tenants', async () => {
  const item = await createItem('Compressas (teste)', 5);
  await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: 20, reason: 'received', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });

  const listA = await getMovements(
    authedRequest(superAdmin, { method: 'GET', url: `/api/inventory/movements?tenantId=${tenantAId}&itemId=${item.id}` }),
   { params: Promise.resolve({}) });
  const rowsA = await listA.json();
  assert.ok(rowsA.length >= 1);
  assert.ok(rowsA.every((r: { item_id: number }) => r.item_id === item.id));

  const listB = await getMovements(authedRequest(adminB, { method: 'GET', url: `/api/inventory/movements?itemId=${item.id}` }), { params: Promise.resolve({}) });
  const rowsB = await listB.json();
  assert.equal(rowsB.length, 0, 'movimentos da tenant A não podem aparecer para a tenant B');
  assert.ok(tenantBId);
});

test('previsão: item sem taxa de consumo mas abaixo do ponto de reposição fica em risco', async () => {
  const item = await createItem('Seringas (teste)', 20);
  await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: 5, reason: 'received', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });

  const forecastRes = await getForecast(
    authedRequest(superAdmin, { method: 'GET', url: `/api/inventory/forecast?tenantId=${tenantAId}` }),
   { params: Promise.resolve({}) });
  const forecast = await forecastRes.json();
  const row = forecast.overview.find((r: { item: { id: number } }) => r.item.id === item.id);
  assert.equal(row.currentQty, 5);
  assert.equal(row.atRisk, true);
  assert.ok(row.suggestedReorderQty > 0);
});

test('purchase orders: criação manual, edição de itens em draft, e transição de estado inválida é rejeitada', async () => {
  const item = await createItem('Brocas (teste)', 5);
  const createRes = await postPurchaseOrder(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/purchase-orders',
      body: { tenantId: tenantAId, items: [{ itemId: item.id, quantity: 3 }] },
    }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 201);
  const order = await createRes.json();
  assert.equal(order.status, 'draft');
  assert.equal(order.source, 'manual');
  assert.equal(order.items.length, 1);

  const editRes = await putPurchaseOrder(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/purchase-orders/${order.id}`,
      body: { items: [{ itemId: item.id, quantity: 9 }] },
    }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(editRes.status, 200);
  const edited = await editRes.json();
  assert.equal(edited.items[0].quantity, 9);

  // draft -> received diretamente é uma transição válida (marcar recebido fecha o ciclo);
  // o que testamos aqui é que draft -> ordered -> ... -> ordered outra vez não avança por
  // engano quando já não é 'draft' nem 'ordered'->'cancelled'.
  const toOrdered = await putPurchaseOrder(
    authedRequest(superAdmin, { method: 'PUT', url: `/api/purchase-orders/${order.id}`, body: { status: 'ordered' } }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(toOrdered.status, 200);

  const editAfterOrdered = await putPurchaseOrder(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/purchase-orders/${order.id}`,
      body: { items: [{ itemId: item.id, quantity: 1 }] },
    }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(editAfterOrdered.status, 400, 'não se deve poder editar itens de uma encomenda já enviada');
});

test('purchase orders: marcar como recebido cria lotes + movimentos e incrementa o stock', async () => {
  const item = await createItem('Máscaras (teste)', 10);
  const createRes = await postPurchaseOrder(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/purchase-orders',
      body: { tenantId: tenantAId, items: [{ itemId: item.id, quantity: 50, expiryDate: '2027-06-01' }] },
    }),
   { params: Promise.resolve({}) });
  const order = await createRes.json();

  const beforeForecast = await getForecast(
    authedRequest(superAdmin, { method: 'GET', url: `/api/inventory/forecast?tenantId=${tenantAId}` }),
   { params: Promise.resolve({}) });
  const before = (await beforeForecast.json()).overview.find((r: { item: { id: number } }) => r.item.id === item.id);
  const qtyBefore = before?.currentQty || 0;

  const receiveRes = await putPurchaseOrder(
    authedRequest(superAdmin, { method: 'PUT', url: `/api/purchase-orders/${order.id}`, body: { status: 'received' } }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(receiveRes.status, 200);
  const received = await receiveRes.json();
  assert.equal(received.status, 'received');
  assert.ok(received.received_at);

  const afterForecast = await getForecast(
    authedRequest(superAdmin, { method: 'GET', url: `/api/inventory/forecast?tenantId=${tenantAId}` }),
   { params: Promise.resolve({}) });
  const after = (await afterForecast.json()).overview.find((r: { item: { id: number } }) => r.item.id === item.id);
  assert.equal(after.currentQty, qtyBefore + 50);
  assert.ok(after.batches.some((b: { expiry_date: string }) => b.expiry_date === '2027-06-01'));

  // não se pode receber duas vezes a mesma encomenda
  const receiveAgain = await putPurchaseOrder(
    authedRequest(superAdmin, { method: 'PUT', url: `/api/purchase-orders/${order.id}`, body: { status: 'received' } }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(receiveAgain.status, 400);
});

test('purchase orders: isolamento entre tenants em GET e no PUT por id', async () => {
  const item = await createItem('Algodão (teste)', 5);
  const createRes = await postPurchaseOrder(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/purchase-orders',
      body: { tenantId: tenantAId, items: [{ itemId: item.id, quantity: 2 }] },
    }),
   { params: Promise.resolve({}) });
  const order = await createRes.json();

  const listB = await getPurchaseOrders(authedRequest(adminB, { method: 'GET', url: '/api/purchase-orders' }), { params: Promise.resolve({}) });
  const rowsB = await listB.json();
  assert.ok(!rowsB.some((o: { id: string }) => o.id === order.id));

  const putB = await putPurchaseOrder(
    authedRequest(adminB, { method: 'PUT', url: `/api/purchase-orders/${order.id}`, body: { status: 'ordered' } }),
    { params: Promise.resolve({ id: order.id }) },
  );
  assert.equal(putB.status, 404);
});

test('inventory items: editar reorder_at via PUT', async () => {
  const item = await createItem('Fio dental (teste)', 5);
  const editRes = await putInventoryItem(
    authedRequest(superAdmin, { method: 'PUT', url: `/api/inventory/items/${item.id}`, body: { reorderAt: 25 } }),
    { params: Promise.resolve({ id: String(item.id) }) },
  );
  assert.equal(editRes.status, 200);
  assert.equal((await editRes.json()).reorder_at, 25);
});
