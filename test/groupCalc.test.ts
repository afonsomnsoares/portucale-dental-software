import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateForecast,
  canOfferAcrossClinics,
  type ClinicCapacity,
  findImbalances,
  freeMinutes,
  imbalanceValueEur,
  occupancy,
  spareCapacity,
  unmetDemand,
  weightedRate,
} from '../lib/groupCalc.ts';

/** Uma unidade cheia (ocupação acima do limiar) com gente à espera. */
function cheia(tenantId: string, name: string, waitingMinutes: number, waitingPatients: number): ClinicCapacity {
  return { tenantId, name, capacityMinutes: 10_000, bookedMinutes: 9_000, waitingMinutes, waitingPatients };
}

/** Uma unidade com folga. */
function vazia(tenantId: string, name: string, bookedMinutes = 2_000): ClinicCapacity {
  return { tenantId, name, capacityMinutes: 10_000, bookedMinutes, waitingMinutes: 0, waitingPatients: 0 };
}

// ─── Procura e folga ────────────────────────────────────────────────────────

test('ocupação e tempo livre saem da capacidade e do que já está marcado', () => {
  const c = { tenantId: 'a', name: 'A', capacityMinutes: 1_000, bookedMinutes: 400, waitingMinutes: 0, waitingPatients: 0 };
  assert.equal(occupancy(c), 0.4);
  assert.equal(freeMinutes(c), 600);
  // Uma unidade sem capacidade declarada não é uma unidade cheia: é uma sem dados, e
  // 0/0 tinha de dar NaN algures se não fosse tratado.
  assert.equal(occupancy({ ...c, capacityMinutes: 0 }), 0);
});


// A lista de espera é, empiricamente, procura que não foi servida: se a unidade a
// pudesse absorver, já a tinha absorvido. O que a qualifica é a unidade estar cheia.
test('uma unidade cheia com lista de espera tem procura por satisfazer', () => {
  assert.equal(unmetDemand(cheia('a', 'A', 600, 10)), 600);
});

// A primeira versão deste modelo comparava minutos à espera com minutos livres. Com
// números reais dava zero em toda a parte — a capacidade de duas semanas são dezenas de
// milhares de minutos e nenhuma lista de espera lhe chega. Este teste tranca a correção.
test('uma unidade com folga não tem procura por satisfazer, por maior que seja a lista', () => {
  const folgada = { ...vazia('a', 'A'), waitingMinutes: 5_000, waitingPatients: 80 };
  assert.equal(unmetDemand(folgada), 0, 'se a podia absorver, já a tinha absorvido');
});

test('folga e procura nunca são positivas ao mesmo tempo', () => {
  for (const c of [cheia('a', 'A', 600, 10), vazia('b', 'B')]) {
    assert.ok(unmetDemand(c) === 0 || spareCapacity(c) === 0);
  }
});

test('uma unidade não empresta a capacidade de que precisa', () => {
  const comListaPropria = { ...vazia('b', 'B'), waitingMinutes: 3_000, waitingPatients: 50 };
  // 8000 livres menos 3000 que ela própria precisa.
  assert.equal(spareCapacity(comListaPropria), 5_000);
});

test('uma unidade cheia nunca aparece como quem pode ajudar', () => {
  assert.equal(spareCapacity(cheia('a', 'A', 0, 0)), 0);
});

// ─── Emparelhamento ─────────────────────────────────────────────────────────

test('emparelha quem tem lista de espera com quem tem agenda livre', () => {
  const [m] = findImbalances([
    cheia('porto', 'Porto', 900, 20),
    { tenantId: 'lisboa', name: 'Lisboa', capacityMinutes: 1_000, bookedMinutes: 400, waitingMinutes: 0, waitingPatients: 0 },
  ]);
  assert.equal(m.fromName, 'Porto');
  assert.equal(m.toName, 'Lisboa');
  assert.equal(m.movableMinutes, 600);
  // 900 min para 20 pessoas = 45 min cada; 600 min dão 13 pessoas.
  assert.equal(m.movablePatients, 13);
});

// A armadilha que buildGapFillMoves já evita dentro de uma clínica: sem alocar cada
// minuto uma só vez, três unidades com procura recebem todas a mesma hora livre da
// quarta, e o total promete o triplo do que existe.
test('a mesma capacidade não é prometida a duas clínicas', () => {
  const moves = findImbalances([
    cheia('a', 'A', 600, 10),
    cheia('b', 'B', 600, 10),
    { tenantId: 'c', name: 'C', capacityMinutes: 1_000, bookedMinutes: 400, waitingMinutes: 0, waitingPatients: 0 },
  ]);
  const total = moves.reduce((s, m) => s + m.movableMinutes, 0);
  assert.equal(total, 600, 'só existem 600 minutos livres em todo o grupo');
});

test('uma clínica não se emparelha consigo própria', () => {
  // Uma só unidade: mesmo cheia e com lista, não há para onde mover.
  const moves = findImbalances([cheia('a', 'A', 600, 10)]);
  assert.deepEqual(moves, []);
});

// Mover vinte minutos entre cidades não é uma proposta — é incomodar duas clínicas por
// nada.
test('desequilíbrios pequenos não produzem propostas', () => {
  const moves = findImbalances([
    cheia('a', 'A', 30, 1),
    { tenantId: 'b', name: 'B', capacityMinutes: 1_000, bookedMinutes: 970, waitingMinutes: 0, waitingPatients: 0 },
  ]);
  assert.deepEqual(moves, []);
});

test('sem folga em lado nenhum não há nada a propor', () => {
  assert.deepEqual(findImbalances([cheia('a', 'A', 600, 5), cheia('b', 'B', 600, 5)]), []);
});

// ─── Euros ──────────────────────────────────────────────────────────────────

test('o valor usa a receita por hora de quem RECEBE', () => {
  assert.equal(imbalanceValueEur(600, 120), 1200);
  // Sem receita de referência o valor é desconhecido, e não zero.
  assert.equal(imbalanceValueEur(600, null), null);
});

// ─── A porta legal ──────────────────────────────────────────────────────────
// Duas condições que não se substituem: uma é sobre o responsável pelo tratamento, a
// outra é sobre o doente.

test('faltando a base legal da clínica, não se oferece', () => {
  const r = canOfferAcrossClinics({ clinicAllowsTransfers: false, patientConsented: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /base legal/);
});

test('faltando o consentimento do doente, também não', () => {
  const r = canOfferAcrossClinics({ clinicAllowsTransfers: true, patientConsented: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /consentiu/);
});

test('com as duas, pode', () => {
  assert.equal(canOfferAcrossClinics({ clinicAllowsTransfers: true, patientConsented: true }).ok, true);
});

// ─── Agregação ──────────────────────────────────────────────────────────────

test('as previsões somam-se e as pouco fiáveis vão nomeadas, não excluídas', () => {
  const a = aggregateForecast([
    { tenantId: 'a', name: 'A', value: 1000, reliable: true },
    { tenantId: 'b', name: 'B', value: 500, reliable: false },
  ]);
  // Excluir a pouco fiável daria um total mais baixo com ar de mais rigoroso.
  assert.equal(a.total, 1500);
  assert.deepEqual(a.unreliableClinics, ['B']);
  assert.equal(a.contributors, 2);
});

// O erro clássico: a média das taxas não é a taxa do total. Uma unidade com 30 consultas
// não pode pesar o mesmo que uma com 300.
test('a taxa do grupo é ponderada, não a média das taxas', () => {
  const r = weightedRate([
    { numerator: 15, denominator: 30 }, // 50%
    { numerator: 15, denominator: 300 }, // 5%
  ]);
  assert.ok(r !== null);
  // Média simples daria 27,5%. A verdadeira é 30/330.
  assert.ok(Math.abs(r - 30 / 330) < 1e-9);
});

test('sem denominador a taxa é null, e nunca zero', () => {
  assert.equal(weightedRate([{ numerator: 0, denominator: 0 }]), null);
  assert.equal(weightedRate([]), null);
});
