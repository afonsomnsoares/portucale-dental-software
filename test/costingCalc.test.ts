import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOCATION_METHODS,
  type AllocationBasis,
  allocatedFixedCost,
  computeMargin,
  costCoverage,
  DEFAULT_ALLOCATION_METHOD,
  fixedCostRate,
  isAllocationMethod,
  labourCost,
  materialCostForProcedure,
  roundEUR,
  stockValue,
  sumMargins,
  unitCostFor,
  weightedAverageCost,
} from '../lib/costingCalc.ts';

test('roundEUR fecha em cêntimos e não propaga NaN', () => {
  assert.equal(roundEUR(1.005), 1.0); // binário, não decimal — documentado, não acidental
  assert.equal(roundEUR(2.346), 2.35);
  assert.equal(roundEUR('abc'), 0);
  assert.equal(roundEUR(null), 0);
});

test('o método por omissão é um dos métodos válidos', () => {
  assert.ok(ALLOCATION_METHODS.includes(DEFAULT_ALLOCATION_METHOD));
  assert.ok(isAllocationMethod('per_chair_hour'));
  assert.equal(isAllocationMethod('inventado'), false);
  assert.equal(isAllocationMethod(null), false);
});

// ─── Custo unitário: catálogo vs clínica ────────────────────────────────────

test('o override da clínica manda sobre o catálogo', () => {
  assert.equal(unitCostFor(10, 7.5), 7.5);
});

test('sem override vale o catálogo', () => {
  assert.equal(unitCostFor(10, null), 10);
  assert.equal(unitCostFor(10, ''), 10);
  assert.equal(unitCostFor(10, undefined), 10);
});

test('um override de zero é um preço, não uma ausência de preço', () => {
  assert.equal(unitCostFor(10, 0), 0, 'material oferecido pelo fornecedor custa zero, e isso é uma decisão da clínica');
});

test('sem preço em lado nenhum o custo é zero', () => {
  assert.equal(unitCostFor(null, null), 0);
});

// ─── Custo médio ponderado ──────────────────────────────────────────────────

test('weightedAverageCost pondera pelas quantidades, não pelo número de lotes', () => {
  const media = weightedAverageCost([
    { quantity: 90, unitCost: 1 },
    { quantity: 10, unitCost: 11 },
  ]);
  assert.equal(media, 2, 'a média simples daria 6 — noventa unidades não valem o mesmo que dez');
});

test('lotes sem custo registado não puxam a média para baixo', () => {
  const media = weightedAverageCost([
    { quantity: 50, unitCost: 4 },
    { quantity: 50, unitCost: null },
  ]);
  assert.equal(media, 4, 'um lote sem preço não foi oferecido — é um lote sem preço');
});

test('sem nenhum lote custeado cai para o valor de referência', () => {
  assert.equal(weightedAverageCost([{ quantity: 10, unitCost: null }], 3.2), 3.2);
  assert.equal(weightedAverageCost([], 3.2), 3.2);
});

test('lotes esgotados não entram na média', () => {
  assert.equal(weightedAverageCost([{ quantity: 0, unitCost: 99 }, { quantity: 10, unitCost: 2 }]), 2);
});

test('stockValue multiplica e nunca devolve negativo', () => {
  assert.equal(stockValue(10, 2.5), 25);
  assert.equal(stockValue(-5, 2.5), 0);
});

// ─── Custo direto ───────────────────────────────────────────────────────────

test('materialCostForProcedure soma consumo × preço', () => {
  assert.equal(
    materialCostForProcedure([
      { itemId: 1, qtyPerProcedure: 2, unitCost: 1.5 },
      { itemId: 2, qtyPerProcedure: 1, unitCost: 4 },
    ]),
    7,
  );
});

test('um procedimento sem material mapeado custa zero em material', () => {
  assert.equal(materialCostForProcedure([]), 0);
});

test('labourCost converte minutos em horas', () => {
  assert.equal(labourCost(90, 40), 60);
  assert.equal(labourCost(30, 40), 20);
});

test('sem custo/hora declarado a mão de obra é zero, não uma média inventada', () => {
  assert.equal(labourCost(60, null), 0);
});

// ─── Imputação do custo fixo ────────────────────────────────────────────────

const BASE: AllocationBasis = {
  method: 'per_chair_hour',
  fixedCostForPeriod: 20000,
  occupiedChairHours: 400,
  appointmentsInPeriod: 500,
};

test('per_chair_hour dá um custo por hora e cobra a duração', () => {
  assert.equal(fixedCostRate(BASE), 50);
  assert.equal(allocatedFixedCost(BASE, 60), 50);
  assert.equal(allocatedFixedCost(BASE, 30), 25);
  assert.equal(allocatedFixedCost(BASE, 90), 75);
});

test('per_appointment ignora a duração de propósito', () => {
  const basis: AllocationBasis = { ...BASE, method: 'per_appointment' };
  assert.equal(fixedCostRate(basis), 40);
  assert.equal(allocatedFixedCost(basis, 30), 40);
  assert.equal(allocatedFixedCost(basis, 120), 40, 'trata um controlo como uma reabilitação — é a escolha do método');
});

test('direct_only não imputa nada', () => {
  const basis: AllocationBasis = { ...BASE, method: 'direct_only' };
  assert.equal(fixedCostRate(basis), 0);
  assert.equal(allocatedFixedCost(basis, 120), 0);
});

// A propriedade que torna este método o que penaliza os espaços vazios: com metade da
// ocupação, cada hora ocupada carrega o dobro do custo fixo.
test('menos ocupação torna cada hora ocupada mais cara', () => {
  const cheia = fixedCostRate(BASE);
  const meia = fixedCostRate({ ...BASE, occupiedChairHours: 200 });
  assert.equal(meia, cheia * 2);
});

test('sem base de imputação não se inventa uma taxa', () => {
  assert.equal(fixedCostRate({ ...BASE, occupiedChairHours: 0 }), 0);
  assert.equal(fixedCostRate({ ...BASE, method: 'per_appointment', appointmentsInPeriod: 0 }), 0);
  assert.equal(fixedCostRate({ ...BASE, fixedCostForPeriod: 0 }), 0);
});

// ─── Margem ─────────────────────────────────────────────────────────────────

test('computeMargin separa contribuição de líquida', () => {
  const m = computeMargin({ revenue: 200, materialCost: 30, labourCost: 50, allocatedFixedCost: 60 });
  assert.equal(m.contributionMargin, 120);
  assert.equal(m.contributionMarginPct, 60);
  assert.equal(m.netMargin, 60);
  assert.equal(m.netMarginPct, 30);
});

// O caso que justifica as duas margens existirem lado a lado.
test('um tratamento pode contribuir e ainda assim dar prejuízo', () => {
  const m = computeMargin({ revenue: 100, materialCost: 20, labourCost: 40, allocatedFixedCost: 60 });
  assert.ok(m.contributionMargin > 0, 'deixa 40 € para pagar a estrutura');
  assert.ok(m.netMargin < 0, 'mas a estrutura que consome custa 60 €');
});

test('com direct_only as duas margens coincidem', () => {
  const m = computeMargin({ revenue: 100, materialCost: 20, labourCost: 30, allocatedFixedCost: 0 });
  assert.equal(m.contributionMargin, m.netMargin);
});

test('sem receita a percentagem é null e não 0', () => {
  const m = computeMargin({ revenue: 0, materialCost: 10 });
  assert.equal(m.contributionMarginPct, null);
  assert.equal(m.netMarginPct, null);
  assert.equal(m.contributionMargin, -10);
});

// O erro clássico que sumMargins existe para não cometer.
test('sumMargins recalcula as percentagens sobre os totais', () => {
  const total = sumMargins([
    computeMargin({ revenue: 1000, materialCost: 100 }),
    computeMargin({ revenue: 10, materialCost: 9 }),
  ]);
  assert.equal(total.revenue, 1010);
  assert.equal(total.contributionMargin, 901);
  const mediaDasPercentagens = (90 + 10) / 2;
  assert.notEqual(total.contributionMarginPct, mediaDasPercentagens);
  assert.equal(total.contributionMarginPct, 89.2);
});

test('sumMargins de nada é zero e não NaN', () => {
  const total = sumMargins([]);
  assert.equal(total.revenue, 0);
  assert.equal(total.netMarginPct, null);
});

// ─── Cobertura ──────────────────────────────────────────────────────────────

test('costCoverage diz de que é feito o número', () => {
  const c = costCoverage(7, 10);
  assert.equal(c.coveragePct, 70);
  assert.ok(c.reliable);
  assert.equal(costCoverage(6, 10).reliable, false);
});

test('sem itens nenhuns a cobertura não é fiável', () => {
  const c = costCoverage(0, 0);
  assert.equal(c.coveragePct, 0);
  assert.equal(c.reliable, false);
});
