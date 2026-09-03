import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  batchExpiryStatus,
  computeConsumptionRate,
  daysUntilStockout,
  isAtRisk,
  planFefoConsumption,
  procedureDemand,
  suggestReorderQuantity,
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
