import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLifecycleStage,
  dormancyBand,
  isOutreachDue,
  LIFECYCLE_STAGES,
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
