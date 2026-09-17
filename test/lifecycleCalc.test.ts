import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLifecycleStage,
  dormancyBand,
  isOutreachDue,
  DEFAULT_INACTIVE_MONTHS,
  LIFECYCLE_STAGES,
  lifecycleStages,
  segmentReactivationCandidate,
  valueTier,
} from '../lib/lifecycleCalc.ts';

const NOW = new Date('2026-08-24T12:00:00Z');

function signals(overrides: Partial<Parameters<typeof computeLifecycleStage>[0]> = {}) {
  return {
    visitCount: 0,
    lastVisit: null,
    createdAt: NOW.toISOString(),
    hasOpenTreatment: false,
    hasFutureAppointment: false,
    ...overrides,
  };
}

test('LIFECYCLE_STAGES lists exactly the 4 stages in a stable order', () => {
  assert.deepEqual(
    LIFECYCLE_STAGES.map((s) => s.key),
    ['new', 'in_treatment', 'stable', 'inactive'],
  );
});

test('an open treatment always wins, regardless of how stale the patient is', () => {
  const stage = computeLifecycleStage(
    signals({ visitCount: 3, lastVisit: '2020-01-01', hasOpenTreatment: true }),
    NOW,
  );
  assert.equal(stage, 'in_treatment');
});

test('a future appointment always wins too', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 0, hasFutureAppointment: true }), NOW);
  assert.equal(stage, 'in_treatment');
});

test('never visited, registered recently, nothing open -> new', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 0, createdAt: '2026-08-01' }), NOW);
  assert.equal(stage, 'new');
});

test('never visited, registered long ago, nothing open -> inactive (a dead never-booked lead)', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 0, createdAt: '2025-01-01' }), NOW);
  assert.equal(stage, 'inactive');
});

test('visited before, recently, nothing open -> stable', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 4, lastVisit: '2026-08-01' }), NOW);
  assert.equal(stage, 'stable');
});

test('visited before, but not for a long time, nothing open -> inactive', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 4, lastVisit: '2025-01-01' }), NOW);
  assert.equal(stage, 'inactive');
});

test('visited before but lastVisit missing (data gap) -> treated as inactive, not stable', () => {
  const stage = computeLifecycleStage(signals({ visitCount: 2, lastVisit: null }), NOW);
  assert.equal(stage, 'inactive');
});

test('respects a custom inactiveMonths threshold', () => {
  const nearlyStale = signals({ visitCount: 1, lastVisit: '2026-07-01' });
  assert.equal(computeLifecycleStage(nearlyStale, NOW, 1), 'inactive');
  assert.equal(computeLifecycleStage(nearlyStale, NOW, 6), 'stable');
});

test('isOutreachDue: never contacted -> due', () => {
  assert.equal(isOutreachDue(null, NOW), true);
  assert.equal(isOutreachDue(undefined, NOW), true);
});

test('isOutreachDue: contacted recently -> not due', () => {
  const fiveDaysAgo = new Date(NOW.getTime() - 5 * 86400000).toISOString();
  assert.equal(isOutreachDue(fiveDaysAgo, NOW), false);
});

test('isOutreachDue: contacted past the cooldown window -> due again', () => {
  const fortyDaysAgo = new Date(NOW.getTime() - 40 * 86400000).toISOString();
  assert.equal(isOutreachDue(fortyDaysAgo, NOW), true);
});

test('isOutreachDue: respects a custom cooldown', () => {
  const tenDaysAgo = new Date(NOW.getTime() - 10 * 86400000).toISOString();
  assert.equal(isOutreachDue(tenDaysAgo, NOW, 7), true);
  assert.equal(isOutreachDue(tenDaysAgo, NOW, 14), false);
});

test('dormancyBand buckets by months inactive', () => {
  assert.equal(dormancyBand(7), '6-12m');
  assert.equal(dormancyBand(12), '12-24m');
  assert.equal(dormancyBand(18), '12-24m');
  assert.equal(dormancyBand(24), '24m+');
  assert.equal(dormancyBand(36), '24m+');
});

test('valueTier crosses over at the high-value threshold', () => {
  assert.equal(valueTier(0), 'standard');
  assert.equal(valueTier(499), 'standard');
  assert.equal(valueTier(500), 'high');
});

test('segmentReactivationCandidate: 18-months-dormant high-value patient (the spec example)', () => {
  const segment = segmentReactivationCandidate({ monthsInactive: 18, lifetimeValue: 1200 });
  assert.deepEqual(segment, { dormancyBand: '12-24m', valueTier: 'high' });
});

// ─── O limiar é da clínica (migração 060) ───────────────────────────────────
// Seis meses não é um facto sobre medicina dentária: numa clínica de manutenção é o
// ciclo normal e ninguém desapareceu; numa de ortodontia, dois meses de silêncio já é
// um doente perdido.

test('o mesmo doente é "desaparecido" ou não consoante o limiar da clínica', () => {
  const agora = new Date('2026-09-17T12:00:00Z');
  const sinais = {
    visitCount: 3,
    lastVisit: '2026-05-17', // quatro meses antes
    createdAt: '2024-01-01',
    hasOpenTreatment: false,
    hasFutureAppointment: false,
  };

  assert.equal(computeLifecycleStage(sinais, agora, 6), 'stable', 'quatro meses não chega a seis');
  assert.equal(computeLifecycleStage(sinais, agora, 3), 'inactive', 'mas passa três');
});

test('sem limiar declarado vale o valor por omissão', () => {
  const agora = new Date('2026-09-17T12:00:00Z');
  const sinais = {
    visitCount: 1,
    lastVisit: '2026-01-01',
    createdAt: '2024-01-01',
    hasOpenTreatment: false,
    hasFutureAppointment: false,
  };
  assert.equal(computeLifecycleStage(sinais, agora), computeLifecycleStage(sinais, agora, DEFAULT_INACTIVE_MONTHS));
});

// O ecrã não pode dizer «mais de 6 meses» a uma clínica que escolheu três.
test('a descrição da etapa traz o limiar da clínica', () => {
  const tres = lifecycleStages(3).find((s) => s.key === 'inactive');
  assert.match(String(tres?.description), /3 meses/);
  const catorze = lifecycleStages(14).find((s) => s.key === 'inactive');
  assert.match(String(catorze?.description), /14 meses/);
});

// Um tratamento em aberto ou uma consulta marcada ganham a qualquer limiar: quem tem
// consulta para a semana não desapareceu, tenha a clínica posto o limiar em que puser.
test('nenhum limiar torna "desaparecido" quem tem consulta marcada', () => {
  const agora = new Date('2026-09-17T12:00:00Z');
  const sinais = {
    visitCount: 2,
    lastVisit: '2019-01-01',
    createdAt: '2018-01-01',
    hasOpenTreatment: false,
    hasFutureAppointment: true,
  };
  assert.equal(computeLifecycleStage(sinais, agora, 1), 'in_treatment');
});
