import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_BASIS, TREND_CAP, byWeekday, forecast, isReliable, mad, median, trendFactor } from '../lib/forecastCalc.ts';

// Segundas a sextas de várias semanas, com valor fixo por dia da semana.
function weekdaySeries(weeks: number, valueByWeekday: Record<number, number>, startIso = '2026-01-05') {
  const out: { date: string; value: number }[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  for (let d = 0; d < weeks * 7; d++) {
    const day = new Date(start.getTime());
    day.setUTCDate(day.getUTCDate() + d);
    const v = valueByWeekday[day.getUTCDay()];
    if (v === undefined) continue;
    out.push({ date: day.toISOString().slice(0, 10), value: v });
  }
  return out;
}

test('median e mad ignoram valores não finitos e não se deixam mover por um outlier', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
  // Um valor absurdo move a média para ~2000 e deixa a mediana onde estava.
  assert.equal(median([10, 10, 10, 10, 10000]), 10);
  assert.equal(mad([10, 10, 10, 10, 10000]), 0);
});

test('byWeekday não inventa dias: um dia nunca trabalhado não aparece', () => {
  const history = weekdaySeries(4, { 1: 100, 3: 200 }); // só segundas e quartas
  const groups = byWeekday(history);
  assert.deepEqual([...groups.keys()].sort(), [1, 3]);
  assert.equal(groups.get(0), undefined, 'domingo não pode aparecer');
});

test('a previsão só cobre os dias em que a clínica trabalha', () => {
  const history = weekdaySeries(6, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 });
  const r = forecast(history, 14, new Date('2026-02-15T00:00:00Z'));
  assert.ok(r.days.length > 0);
  assert.ok(
    r.days.every((d) => d.weekday >= 1 && d.weekday <= 5),
    'não pode prever para sábado ou domingo se nunca houve consultas nesses dias',
  );
});

test('série estável: prevê o mesmo valor, sem tendência inventada', () => {
  const history = weekdaySeries(8, { 1: 500, 2: 500, 3: 500, 4: 500, 5: 500 });
  const r = forecast(history, 7, new Date('2026-03-01T00:00:00Z'));
  assert.equal(r.trend, 1);
  for (const d of r.days) assert.equal(d.value, 500);
  assert.equal(r.totalLow, r.total, 'sem dispersão, a banda colapsa no valor');
});

test('a tendência é detetada mas nunca ultrapassa o travão', () => {
  // Primeira metade a 100, segunda a 1000 — razão de 10x.
  const history = [
    ...weekdaySeries(4, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 }, '2026-01-05'),
    ...weekdaySeries(4, { 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000 }, '2026-02-02'),
  ];
  const t = trendFactor(history);
  assert.equal(t, 1 + TREND_CAP, 'sem travão, duas boas semanas extrapolavam para o infinito');
});

test('histórico curto não afirma tendência nenhuma', () => {
  assert.equal(trendFactor(weekdaySeries(1, { 1: 10, 2: 20 })), 1);
});

test('base zero não produz tendência (divisão sem denominador)', () => {
  const history = [
    ...weekdaySeries(4, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, '2026-01-05'),
    ...weekdaySeries(4, { 1: 900, 2: 900, 3: 900, 4: 900, 5: 900 }, '2026-02-02'),
  ];
  assert.equal(trendFactor(history), 1);
});

test('isReliable rejeita a previsão construída sobre poucas observações', () => {
  const magro = forecast(weekdaySeries(1, { 1: 100, 2: 100, 3: 100 }), 14, new Date('2026-01-12T00:00:00Z'));
  assert.equal(isReliable(magro), false, 'uma semana de histórico não sustenta duas de previsão');

  const gordo = forecast(weekdaySeries(10, { 1: 100, 2: 100, 3: 100 }), 14, new Date('2026-03-16T00:00:00Z'));
  assert.equal(isReliable(gordo), true);
  assert.ok(gordo.days.every((d) => d.basis >= MIN_BASIS));
});

test('horizonte zero ou negativo devolve vazio em vez de rebentar', () => {
  const history = weekdaySeries(6, { 1: 100 });
  assert.equal(forecast(history, 0).days.length, 0);
  assert.equal(forecast(history, -5).days.length, 0);
  assert.equal(forecast([], 14).total, 0);
});
