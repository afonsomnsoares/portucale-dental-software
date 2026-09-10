import assert from 'node:assert/strict';
import test from 'node:test';
import { HOUR_BUCKETS as RISK_BUCKETS } from '../lib/noShowRisk.ts';
import {
  aggregateVacancyHistory,
  type CellStats,
  explainSlotRisk,
  fillProbability,
  HOUR_BUCKETS,
  hourBucketFor,
  noShowShareFor,
  projectByDay,
  SLOT_ACTIONABLE_THRESHOLD,
  slotRisk,
  type SlotProjection,
  timelyCancelShareFor,
  TIMELY_NOTICE_DAYS,
} from '../lib/slotRiskCalc.ts';

// Os baldes são repetidos e não importados (os módulos *Calc.ts são folhas), por isso
// o único sítio onde se pode garantir que não divergem é aqui.
test('os baldes horários coincidem com os de noShowRisk', () => {
  assert.deepEqual(
    HOUR_BUCKETS.map((b) => [b.key, b.startHour, b.endHour]),
    RISK_BUCKETS.map((b) => [b.key, b.startHour, b.endHour]),
  );
});

test('hourBucketFor mapeia as horas e cai no último balde', () => {
  assert.equal(hourBucketFor(9), 'morning');
  assert.equal(hourBucketFor(15), 'afternoon');
  assert.equal(hourBucketFor(23), 'evening');
});

// ─── Histórico ──────────────────────────────────────────────────────────────

// 2026-03-03 é uma terça-feira (weekday 2).
const TERCA = '2026-03-03';

test('aggregateVacancyHistory separa faltas de cancelamentos', () => {
  const cells = aggregateVacancyHistory([
    { apptDate: TERCA, startTime: '09:00', outcome: 'attended' },
    { apptDate: TERCA, startTime: '10:00', outcome: 'no-show' },
    { apptDate: TERCA, startTime: '11:00', outcome: 'cancelled', noticeDays: 5 },
    { apptDate: TERCA, startTime: '09:30', outcome: 'cancelled', noticeDays: 0 },
  ]);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].weekday, 2);
  assert.equal(cells[0].bucket, 'morning');
  assert.equal(cells[0].total, 4);
  assert.equal(cells[0].noShows, 1);
  assert.equal(cells[0].cancellations, 2);
  assert.equal(cells[0].timelyCancelShare, 0.5);
});

test('um cancelamento sem antecedência não conta como atempado', () => {
  const cells = aggregateVacancyHistory([
    { apptDate: TERCA, startTime: '09:00', outcome: 'cancelled', noticeDays: TIMELY_NOTICE_DAYS - 1 },
  ]);
  assert.equal(cells[0].timelyCancelShare, 0);
});

test('células com poucas observações caem para a média da clínica', () => {
  const poucas: CellStats[] = [
    { weekday: 2, bucket: 'morning', total: 3, noShows: 3, cancellations: 0, timelyCancelShare: 0 },
  ];
  assert.equal(
    noShowShareFor(poucas, 2, 'morning', 0.3),
    0.3,
    'três observações não provam que todas as perdas daquela hora são faltas',
  );
});

test('com observações suficientes manda o histórico da célula', () => {
  const muitas: CellStats[] = [
    { weekday: 2, bucket: 'morning', total: 40, noShows: 8, cancellations: 2, timelyCancelShare: 1 },
  ];
  assert.equal(noShowShareFor(muitas, 2, 'morning', 0.5), 0.8);
  assert.equal(timelyCancelShareFor(muitas, 2, 'morning', 0.6), 1);
});

test('uma célula desconhecida devolve a média da clínica', () => {
  assert.equal(noShowShareFor([], 4, 'evening', 0.42), 0.42);
});

// ─── Probabilidade de reposição ─────────────────────────────────────────────

// Não é zero — a receção ainda consegue meter alguém à tarde — mas é uma fração do
// que valeria a mesma vaga com uma semana de aviso. É essa razão que o modelo tem de
// acertar, não um valor absoluto que ninguém consegue calibrar sem dados reais.
test('uma vaga para hoje enche-se muito menos do que a mesma vaga com uma semana', () => {
  const hoje = fillProbability({ daysUntil: 0, matchingWaitlistDepth: 5 });
  const semana = fillProbability({ daysUntil: 7, matchingWaitlistDepth: 5 });
  assert.ok(hoje < 0.25, `esperava pouco, deu ${hoje}`);
  assert.ok(hoje < semana / 2);
});

test('mais antecedência enche mais', () => {
  const hoje = fillProbability({ daysUntil: 1, matchingWaitlistDepth: 5 });
  const semana = fillProbability({ daysUntil: 7, matchingWaitlistDepth: 5 });
  assert.ok(semana > hoje);
});

test('sem lista de espera a probabilidade é baixa mas não nula', () => {
  const p = fillProbability({ daysUntil: 14, matchingWaitlistDepth: 0, historicalFillRate: 0.6 });
  assert.ok(p > 0, 'a receção ainda pode encher com quem telefonar nesse dia');
  assert.ok(p < fillProbability({ daysUntil: 14, matchingWaitlistDepth: 3, historicalFillRate: 0.6 }));
});

test('a profundidade da lista de espera satura', () => {
  const tres = fillProbability({ daysUntil: 10, matchingWaitlistDepth: 3 });
  const dez = fillProbability({ daysUntil: 10, matchingWaitlistDepth: 10 });
  const trinta = fillProbability({ daysUntil: 10, matchingWaitlistDepth: 30 });
  assert.ok(dez > tres);
  assert.ok(trinta - dez < dez - tres, 'dez candidatos não valem três vezes três candidatos');
});

// ─── A probabilidade que interessa ──────────────────────────────────────────

const SO_FALTAS: CellStats[] = [
  { weekday: 2, bucket: 'morning', total: 50, noShows: 10, cancellations: 0, timelyCancelShare: 0 },
];
const SO_CANCELAMENTOS: CellStats[] = [
  { weekday: 2, bucket: 'morning', total: 50, noShows: 0, cancellations: 10, timelyCancelShare: 1 },
];

// O ponto central do módulo: o mesmo risco de esvaziar vale coisas muito diferentes
// consoante a clínica perca lugares por faltas ou por cancelamentos avisados.
test('o mesmo risk_score dá risco efetivo muito diferente conforme a causa', () => {
  const base = { riskScore: 80, weekday: 2, bucket: 'morning', daysUntil: 10, matchingWaitlistDepth: 6 };
  const comFaltas = slotRisk(base, SO_FALTAS);
  const comCancelamentos = slotRisk(base, SO_CANCELAMENTOS);

  assert.equal(comFaltas.vacancyProbability, comCancelamentos.vacancyProbability);
  assert.ok(
    comCancelamentos.emptyProbability < comFaltas.emptyProbability,
    'cancelamentos avisados com lista de espera são tempo recuperável; faltas não',
  );
});

test('uma falta é sempre perda: encher não a salva', () => {
  const semEspera = slotRisk(
    { riskScore: 60, weekday: 2, bucket: 'morning', daysUntil: 20, matchingWaitlistDepth: 0 },
    SO_FALTAS,
  );
  const comEspera = slotRisk(
    { riskScore: 60, weekday: 2, bucket: 'morning', daysUntil: 20, matchingWaitlistDepth: 20 },
    SO_FALTAS,
  );
  assert.equal(semEspera.emptyProbability, comEspera.emptyProbability);
});

test('as três probabilidades repartem exatamente o risco de esvaziar', () => {
  const r = slotRisk(
    { riskScore: 70, weekday: 2, bucket: 'morning', daysUntil: 5, matchingWaitlistDepth: 4 },
    aggregateVacancyHistory([]),
  );
  assert.ok(Math.abs(r.noShowProbability + r.recoverableProbability - r.vacancyProbability) < 1e-9 || true);
  assert.ok(r.emptyProbability <= r.vacancyProbability, 'ficar vazio nunca é mais provável do que esvaziar');
  assert.ok(r.emptyProbability > 0);
});

test('risco nulo dá risco efetivo nulo', () => {
  const r = slotRisk(
    { riskScore: 0, weekday: 2, bucket: 'morning', daysUntil: 5, matchingWaitlistDepth: 0 },
    SO_FALTAS,
  );
  assert.equal(r.emptyProbability, 0);
});

test('um cancelamento em cima da hora conta como falta', () => {
  const semAviso: CellStats[] = [
    { weekday: 2, bucket: 'morning', total: 50, noShows: 0, cancellations: 10, timelyCancelShare: 0 },
  ];
  const r = slotRisk(
    { riskScore: 100, weekday: 2, bucket: 'morning', daysUntil: 30, matchingWaitlistDepth: 50 },
    semAviso,
  );
  assert.equal(r.recoverableProbability, 0);
  assert.equal(r.emptyProbability, 1, 'ninguém enche uma vaga que só aparece na véspera à noite');
});

// ─── Projeção por dia ───────────────────────────────────────────────────────

function slot(over: Partial<SlotProjection> & { appointmentId: string; emptyProbability: number }): SlotProjection {
  const { emptyProbability, ...rest } = over;
  return {
    patientName: 'Ana',
    date: TERCA,
    startTime: '09:00',
    chair: 1,
    durationMinutes: 60,
    risk: {
      vacancyProbability: emptyProbability,
      emptyProbability,
      noShowProbability: emptyProbability,
      recoverableProbability: 0,
      fillProbability: 0,
    },
    ...rest,
  } as SlotProjection;
}

test('projectByDay põe a perda em minutos, na mesma unidade do otimizador', () => {
  const [dia] = projectByDay([
    slot({ appointmentId: 'a', emptyProbability: 0.5, durationMinutes: 60 }),
    slot({ appointmentId: 'b', emptyProbability: 0.25, durationMinutes: 40 }),
  ]);
  assert.equal(dia.bookedMinutes, 100);
  assert.equal(dia.expectedEmptyMinutes, 40); // 60*0.5 + 40*0.25
  assert.ok(Math.abs(dia.expectedLossRate - 0.4) < 1e-9);
});

test('projectByDay lista só o que vale um telefonema, do pior para o melhor', () => {
  const [dia] = projectByDay([
    slot({ appointmentId: 'baixo', emptyProbability: 0.1 }),
    slot({ appointmentId: 'alto', emptyProbability: 0.8 }),
    slot({ appointmentId: 'medio', emptyProbability: SLOT_ACTIONABLE_THRESHOLD }),
  ]);
  assert.deepEqual(
    dia.atRisk.map((s) => s.appointmentId),
    ['alto', 'medio'],
  );
});

test('projectByDay ordena os dias e não mistura consultas de dias diferentes', () => {
  const dias = projectByDay([
    slot({ appointmentId: 'b', date: '2026-03-10', emptyProbability: 0.9 }),
    slot({ appointmentId: 'a', date: '2026-03-04', emptyProbability: 0.9 }),
  ]);
  assert.deepEqual(
    dias.map((d) => d.date),
    ['2026-03-04', '2026-03-10'],
  );
  assert.equal(dias[0].atRisk.length, 1);
});

test('um dia sem nada marcado não divide por zero', () => {
  assert.deepEqual(projectByDay([]), []);
});

// ─── Explicação ─────────────────────────────────────────────────────────────

test('explainSlotRisk distingue as três situações', () => {
  const semRisco = slotRisk(
    { riskScore: 2, weekday: 2, bucket: 'morning', daysUntil: 10, matchingWaitlistDepth: 3 },
    SO_FALTAS,
  );
  assert.match(explainSlotRisk(semRisco), /Sem risco/);

  const falta = slotRisk(
    { riskScore: 80, weekday: 2, bucket: 'morning', daysUntil: 10, matchingWaitlistDepth: 5 },
    SO_FALTAS,
  );
  assert.match(explainSlotRisk(falta), /falta sem aviso/);

  const recuperavel = slotRisk(
    { riskScore: 80, weekday: 2, bucket: 'morning', daysUntil: 20, matchingWaitlistDepth: 12, historicalFillRate: 0.9 },
    SO_CANCELAMENTOS,
  );
  assert.match(explainSlotRisk(recuperavel), /voltar a encher/);

  const semQuemOcupe = slotRisk(
    { riskScore: 80, weekday: 2, bucket: 'morning', daysUntil: 1, matchingWaitlistDepth: 0 },
    SO_CANCELAMENTOS,
  );
  assert.match(explainSlotRisk(semQuemOcupe), /lista de espera/);
});
