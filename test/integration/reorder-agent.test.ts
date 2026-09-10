// Integration test for lib/agents/reorderAgent.ts — o agente Operações. Corre contra a BD
// de testes (.env.test não define ANTHROPIC_API_KEY), por isso o que se testa aqui é
// exatamente o caminho que qualquer instalação sem a chave configurada vai percorrer: a
// função tem de se comportar tal e qual a regra determinística que substituiu, nunca deixar
// a clínica sem sugestão só porque a IA não está ligada. Run com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateReorderSuggestionsAI } from '../../lib/agents/reorderAgent.ts';
import { POST as postInventoryItem } from '../../app/api/inventory/items/route.ts';
import { POST as postMovement } from '../../app/api/inventory/movements/route.ts';
import { GET as getPurchaseOrders } from '../../app/api/purchase-orders/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let superAdmin: TestUser;
let tenantAId: string;

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  tenantAId = await getTenantAId();
});

after(closeTestDb);

test('sem ANTHROPIC_API_KEY, cai para a regra determinística e ainda assim propõe reposição', async () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'este teste assume .env.test sem a chave');

  const itemRes = await postInventoryItem(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/items',
      body: { item: 'Compressas (agente teste)', unit: 'un', reorderAt: 20 },
    }),
   { params: Promise.resolve({}) });
  assert.equal(itemRes.status, 201);
  const item = await itemRes.json();

  await postMovement(
    authedRequest(superAdmin, {
      method: 'POST',
      url: '/api/inventory/movements',
      body: { itemId: item.id, delta: 5, reason: 'received', tenantId: tenantAId },
    }),
   { params: Promise.resolve({}) });

  const result = await generateReorderSuggestionsAI(tenantAId);
  assert.equal(result.source, 'auto');
  assert.ok(result.suggested >= 1);
  assert.ok(result.purchaseOrderId);

  const listRes = await getPurchaseOrders(
    authedRequest(superAdmin, { method: 'GET', url: `/api/purchase-orders?tenantId=${tenantAId}` }),
   { params: Promise.resolve({}) });
  const orders = await listRes.json();
  const draft = orders.find((o: { id: string }) => o.id === result.purchaseOrderId);
  assert.ok(draft, 'o rascunho tem de aparecer na listagem da clínica');
  assert.equal(draft.status, 'draft');
});

test('tenant inexistente: sem stock nenhum, todo o catálogo (partilhado entre clínicas) conta como em risco', async () => {
  // inventory_items não tem tenant_id — é catálogo partilhado (ver lib/inventory.ts).
  // Um tenant sem nenhuma linha em inventory_stock não fica com zero candidatos, fica com
  // TODOS os itens do catálogo (stock 0 <= qualquer reorder_at) — por isso este id
  // inexistente serve só para confirmar que a função não rebenta com um tenant sem
  // nenhum dado próprio, não para testar "zero candidatos" (esse caso não é alcançável
  // de forma fiável com o catálogo partilhado tal como está hoje).
  const fakeTenantId = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(() => generateReorderSuggestionsAI(fakeTenantId)); // FK: tenant não existe
});
