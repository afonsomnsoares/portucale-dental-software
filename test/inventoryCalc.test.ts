import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  batchExpiryStatus,
  classifyStagnant,
  computeConsumptionRate,
  daysUntilStockout,
  isAtRisk,
  planFefoConsumption,
  procedureDemand,
  rankStagnant,
  reconcileOrder,
  type StagnantSignals,
  suggestReorderQuantity,
  summarizeReconciliation,
} from '../lib/inventoryCalc.ts';

test('planFefoConsumption: consome primeiro o lote que expira mais cedo', () => {
  const batches = [
    { id: 'late', quantity: 10, expiryDate: '2026-12-01' },
    { id: 'early', quantity: 5, expiryDate: '2026-09-01' },
  ];
  const plan = planFefoConsumption(batches, 3);
  assert.deepEqual(plan.entries, [{ batchId: 'early', amount: 3 }]);
  assert.equal(plan.shortfall, 0);
});

test('planFefoConsumption: esgota um lote e continua no seguinte', () => {
  const batches = [
    { id: 'early', quantity: 5, expiryDate: '2026-09-01' },
    { id: 'late', quantity: 10, expiryDate: '2026-12-01' },
  ];
  const plan = planFefoConsumption(batches, 8);
  assert.deepEqual(plan.entries, [
    { batchId: 'early', amount: 5 },
    { batchId: 'late', amount: 3 },
  ]);
  assert.equal(plan.shortfall, 0);
});

test('planFefoConsumption: lote sem validade é consumido por último', () => {
  const batches = [
    { id: 'no-expiry', quantity: 10, expiryDate: null },
    { id: 'expires', quantity: 4, expiryDate: '2026-09-01' },
  ];
  const plan = planFefoConsumption(batches, 6);
  assert.deepEqual(plan.entries, [
    { batchId: 'expires', amount: 4 },
    { batchId: 'no-expiry', amount: 2 },
  ]);
});

test('planFefoConsumption: pedir mais do que existe devolve shortfall', () => {
  const batches = [{ id: 'a', quantity: 3, expiryDate: null }];
  const plan = planFefoConsumption(batches, 10);
  assert.deepEqual(plan.entries, [{ batchId: 'a', amount: 3 }]);
  assert.equal(plan.shortfall, 7);
});

test('planFefoConsumption: sem lotes disponíveis devolve tudo como shortfall', () => {
  const plan = planFefoConsumption([], 5);
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.shortfall, 5);
});

test('planFefoConsumption: amount 0 ou negativo não consome nada', () => {
  const batches = [{ id: 'a', quantity: 5, expiryDate: null }];
  assert.deepEqual(planFefoConsumption(batches, 0), { entries: [], shortfall: 0 });
  assert.deepEqual(planFefoConsumption(batches, -1), { entries: [], shortfall: 0 });
});

test('batchExpiryStatus: sem data de validade', () => {
  assert.equal(batchExpiryStatus(null, new Date('2026-08-31')), 'no_expiry');
});

test('batchExpiryStatus: data no passado está expirado', () => {
  assert.equal(batchExpiryStatus('2026-08-30', new Date('2026-08-31')), 'expired');
});

test('batchExpiryStatus: hoje ainda não é expirado, é expiring_soon', () => {
  assert.equal(batchExpiryStatus('2026-08-31', new Date('2026-08-31')), 'expiring_soon');
});

test('batchExpiryStatus: dentro da janela de aviso é expiring_soon', () => {
  assert.equal(batchExpiryStatus('2026-09-15', new Date('2026-08-31'), 30), 'expiring_soon');
});

test('batchExpiryStatus: fora da janela de aviso é ok', () => {
  assert.equal(batchExpiryStatus('2027-01-01', new Date('2026-08-31'), 30), 'ok');
});

test('computeConsumptionRate: divide o total pela janela', () => {
  assert.equal(computeConsumptionRate(90, 30), 3);
});

test('computeConsumptionRate: sem consumo ou sem janela dá 0, nunca negativo/NaN', () => {
  assert.equal(computeConsumptionRate(0, 30), 0);
  assert.equal(computeConsumptionRate(90, 0), 0);
  assert.equal(computeConsumptionRate(-5, 30), 0);
});

test('daysUntilStockout: null quando não há taxa de consumo (nunca esgota a este ritmo)', () => {
  assert.equal(daysUntilStockout(50, 0), null);
});

test('daysUntilStockout: divide o stock atual pela taxa diária, arredondado por baixo', () => {
  assert.equal(daysUntilStockout(50, 3), 16);
});

test('daysUntilStockout: nunca devolve negativo', () => {
  assert.equal(daysUntilStockout(-10, 3), 0);
});

test('isAtRisk: quantidade já no ponto de reposição ou abaixo', () => {
  assert.equal(isAtRisk(5, 10, null, 7), true);
});

test('isAtRisk: projeção de rutura dentro do lead time', () => {
  assert.equal(isAtRisk(100, 10, 5, 7), true);
});

test('isAtRisk: nem quantidade nem projeção em risco', () => {
  assert.equal(isAtRisk(100, 10, 30, 7), false);
});

test('suggestReorderQuantity: com taxa de consumo, cobre targetDays a partir do stock atual', () => {
  assert.equal(suggestReorderQuantity(10, 5, 2, 30), 50); // ceil(2*30)=60, -10 stock = 50
});

test('suggestReorderQuantity: sem taxa de consumo, cai para o heurístico 2x reorder_at', () => {
  assert.equal(suggestReorderQuantity(3, 10, 0, 30), 17); // 2*10 - 3
});

test('suggestReorderQuantity: nunca sugere uma quantidade negativa', () => {
  assert.equal(suggestReorderQuantity(1000, 10, 0, 30), 0);
  assert.equal(suggestReorderQuantity(1000, 5, 2, 30), 0);
});

test('procedureDemand: soma qty_per_procedure × nº de consultas desse tipo, por item', () => {
  const counts = [
    { type: 'Endodontia', count: 5 },
    { type: 'Destartarização', count: 10 },
  ];
  const usage = [
    { itemId: 1, appointmentType: 'Endodontia', qtyPerProcedure: 2 },
    { itemId: 2, appointmentType: 'Endodontia', qtyPerProcedure: 0.5 },
    { itemId: 1, appointmentType: 'Destartarização', qtyPerProcedure: 1 },
  ];
  const demand = procedureDemand(counts, usage);
  assert.deepEqual(
    demand.sort((a, b) => a.itemId - b.itemId),
    [
      { itemId: 1, projectedDemand: 5 * 2 + 10 * 1 },
      { itemId: 2, projectedDemand: 5 * 0.5 },
    ],
  );
});

test('procedureDemand: um tipo de consulta sem mapeamento não contribui nada', () => {
  const counts = [{ type: 'Unmapped Type', count: 20 }];
  const usage = [{ itemId: 1, appointmentType: 'Endodontia', qtyPerProcedure: 2 }];
  assert.deepEqual(procedureDemand(counts, usage), []);
});

test('procedureDemand: sem consultas futuras não há procura', () => {
  const usage = [{ itemId: 1, appointmentType: 'Endodontia', qtyPerProcedure: 2 }];
  assert.deepEqual(procedureDemand([], usage), []);
});

// ═══ Produtos parados ═══════════════════════════════════════════════════════

const HOJE = new Date('2026-03-15T10:00:00Z');

function sinais(over: Partial<StagnantSignals> = {}): StagnantSignals {
  return {
    currentQty: 50,
    lastConsumedAt: '2026-03-10',
    consumedInWindow: 30,
    windowDays: 30,
    nearestExpiry: null,
    ...over,
  };
}

test('classifyStagnant: um item que sai todos os dias está em uso', () => {
  assert.equal(classifyStagnant(sinais(), HOJE), 'active');
});

test('classifyStagnant: sem stock não há nada parado', () => {
  assert.equal(
    classifyStagnant(sinais({ currentQty: 0, lastConsumedAt: null }), HOJE),
    'active',
    'um item esgotado não tem capital imobilizado',
  );
});

test('classifyStagnant: nunca consumido distingue-se de parado', () => {
  assert.equal(classifyStagnant(sinais({ lastConsumedAt: null, consumedInWindow: 0 }), HOJE), 'never_moved');
});

test('classifyStagnant: um trimestre sem sair é parado', () => {
  assert.equal(
    classifyStagnant(sinais({ lastConsumedAt: '2025-11-01', consumedInWindow: 0 }), HOJE),
    'stagnant',
  );
});

test('classifyStagnant: parado e a expirar tem prazo e vem primeiro', () => {
  assert.equal(
    classifyStagnant(sinais({ lastConsumedAt: '2025-11-01', consumedInWindow: 0, nearestExpiry: '2026-04-30' }), HOJE),
    'expiring_dead',
  );
});

test('classifyStagnant: já expirado também é perda com data marcada', () => {
  assert.equal(
    classifyStagnant(sinais({ lastConsumedAt: null, consumedInWindow: 0, nearestExpiry: '2026-01-01' }), HOJE),
    'expiring_dead',
  );
});

test('classifyStagnant: uma validade longínqua não transforma parado em perda', () => {
  assert.equal(
    classifyStagnant(sinais({ lastConsumedAt: '2025-11-01', consumedInWindow: 0, nearestExpiry: '2029-01-01' }), HOJE),
    'stagnant',
  );
});

test('classifyStagnant: continua a sair mas com stock para dois anos é rotação lenta', () => {
  assert.equal(
    classifyStagnant(sinais({ currentQty: 500, consumedInWindow: 1, windowDays: 30 }), HOJE),
    'slow',
  );
});

test('classifyStagnant: uma validade próxima num item que continua a sair não é stock morto', () => {
  assert.equal(
    classifyStagnant(sinais({ nearestExpiry: '2026-04-01' }), HOJE),
    'active',
    'o alerta de validade já existe — isto é sobre material que não roda',
  );
});

test('rankStagnant: o que expira primeiro, depois o que tem mais dinheiro parado', () => {
  const ordenado = rankStagnant([
    { itemId: 1, item: 'Barato parado', status: 'stagnant', currentQty: 5, tiedUpValue: 10, daysSinceConsumed: 200, nearestExpiry: null },
    { itemId: 2, item: 'Caro parado', status: 'stagnant', currentQty: 5, tiedUpValue: 900, daysSinceConsumed: 200, nearestExpiry: null },
    { itemId: 3, item: 'A expirar', status: 'expiring_dead', currentQty: 5, tiedUpValue: 20, daysSinceConsumed: 200, nearestExpiry: '2026-04-01' },
    { itemId: 4, item: 'Em uso', status: 'active', currentQty: 5, tiedUpValue: 5000, daysSinceConsumed: 1, nearestExpiry: null },
  ]);
  assert.deepEqual(ordenado.map((i) => i.itemId), [3, 2, 1]);
});

test('rankStagnant: um item sem preço fica atrás de um com valor conhecido', () => {
  const ordenado = rankStagnant([
    { itemId: 1, item: 'Sem preço', status: 'stagnant', currentQty: 5, tiedUpValue: null, daysSinceConsumed: 200, nearestExpiry: null },
    { itemId: 2, item: 'Com preço', status: 'stagnant', currentQty: 5, tiedUpValue: 1, daysSinceConsumed: 200, nearestExpiry: null },
  ]);
  assert.deepEqual(ordenado.map((i) => i.itemId), [2, 1]);
});

// ═══ Reconciliação de encomendas ════════════════════════════════════════════

const PEDIDO = [
  { itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 },
  { itemId: 2, item: 'Compósito A2', quantity: 4, unitCost: 25 },
];

test('reconcileOrder: uma entrega igual ao pedido não levanta nada', () => {
  assert.deepEqual(reconcileOrder(PEDIDO, [
    { itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 },
    { itemId: 2, item: 'Compósito A2', quantity: 4, unitCost: 25 },
  ]), []);
});

test('reconcileOrder: quantidade a menos com o valor em falta', () => {
  const [d] = reconcileOrder([PEDIDO[0]], [{ itemId: 1, item: 'Luvas M', quantity: 8, unitCost: 5 }]);
  assert.equal(d.kind, 'short');
  assert.equal(d.valueDelta, -10);
  assert.match(d.detail, /faltam 2/);
});

test('reconcileOrder: quantidade a mais também é discrepância', () => {
  const [d] = reconcileOrder([PEDIDO[0]], [{ itemId: 1, item: 'Luvas M', quantity: 12, unitCost: 5 }]);
  assert.equal(d.kind, 'over');
  assert.equal(d.valueDelta, 10);
});

test('reconcileOrder: uma linha que nunca chegou é "missing", não "short"', () => {
  const [d] = reconcileOrder([PEDIDO[0]], []);
  assert.equal(d.kind, 'missing');
  assert.equal(d.receivedQty, 0);
  assert.equal(d.valueDelta, -50);
});

// A discrepância que passa despercebida: a entrega parece perfeita.
test('reconcileOrder: o preço verifica-se mesmo com a quantidade certa', () => {
  const [d] = reconcileOrder([PEDIDO[0]], [{ itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 6 }]);
  assert.equal(d.kind, 'price_variance');
  assert.equal(d.valueDelta, 10);
  assert.match(d.detail, /5 €\/un/);
  assert.match(d.detail, /6 €\/un/);
});

test('reconcileOrder: cêntimos de arredondamento não são variação de preço', () => {
  assert.deepEqual(
    reconcileOrder([PEDIDO[0]], [{ itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5.005 }]),
    [],
  );
});

test('reconcileOrder: um item que ninguém pediu aparece como inesperado', () => {
  const [d] = reconcileOrder([], [{ itemId: 9, item: 'Brinde', quantity: 3, unitCost: 2 }]);
  assert.equal(d.kind, 'unexpected');
  assert.equal(d.valueDelta, 6);
});

test('reconcileOrder: quantidade e preço errados na mesma linha dão duas discrepâncias', () => {
  const ds = reconcileOrder([PEDIDO[0]], [{ itemId: 1, item: 'Luvas M', quantity: 8, unitCost: 7 }]);
  assert.deepEqual(ds.map((d) => d.kind).sort(), ['price_variance', 'short']);
});

test('reconcileOrder: sem preço registado a discrepância existe mas o valor é null', () => {
  const [d] = reconcileOrder(
    [{ itemId: 1, item: 'Luvas M', quantity: 10, unitCost: null }],
    [{ itemId: 1, item: 'Luvas M', quantity: 8, unitCost: null }],
  );
  assert.equal(d.kind, 'short');
  assert.equal(d.valueDelta, null, 'null e não 0 — não se sabe quanto vale, não vale zero');
});

test('summarizeReconciliation: uma encomenda perfeita e paga certo está limpa', () => {
  const s = summarizeReconciliation(PEDIDO, [
    { itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 },
    { itemId: 2, item: 'Compósito A2', quantity: 4, unitCost: 25 },
  ], 150);
  assert.equal(s.orderedValue, 150);
  assert.equal(s.receivedValue, 150);
  assert.equal(s.invoiceDelta, 0);
  assert.ok(s.clean);
});

// A terceira versão da encomenda: a que o dinheiro segue.
test('summarizeReconciliation: portes por explicar impedem que a encomenda esteja limpa', () => {
  const s = summarizeReconciliation(PEDIDO, [
    { itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 },
    { itemId: 2, item: 'Compósito A2', quantity: 4, unitCost: 25 },
  ], 190);
  assert.deepEqual(s.discrepancies, [], 'item a item bate tudo certo');
  assert.equal(s.invoiceDelta, 40);
  assert.equal(s.clean, false);
});

test('summarizeReconciliation: sem fatura registada não se inventa diferença', () => {
  const s = summarizeReconciliation(PEDIDO, [
    { itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 },
    { itemId: 2, item: 'Compósito A2', quantity: 4, unitCost: 25 },
  ]);
  assert.equal(s.invoicedTotal, null);
  assert.equal(s.invoiceDelta, null);
  assert.ok(s.clean);
});

test('summarizeReconciliation: o delta de valor compara o que chegou com o que se pediu', () => {
  const s = summarizeReconciliation(PEDIDO, [{ itemId: 1, item: 'Luvas M', quantity: 10, unitCost: 5 }]);
  assert.equal(s.orderedValue, 150);
  assert.equal(s.receivedValue, 50);
  assert.equal(s.valueDelta, -100);
  assert.equal(s.clean, false);
});
