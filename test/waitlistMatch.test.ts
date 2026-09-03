import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSlot, rankCandidates, type FreedSlot, type WaitlistCandidate } from '../lib/waitlistMatch.ts';

const NOW = new Date('2026-08-24T10:00:00Z'); // Monday

function candidate(overrides: Partial<WaitlistCandidate> = {}): WaitlistCandidate {
  return {
    id: 'c1',
    patient_id: 'p1',
    treatment_type: 'Destartarização',
    preferred_dentist_id: null,
    preferred_days: null,
    preferred_time_start: null,
    preferred_time_end: null,
    min_duration: 30,
    max_wait_until: null,
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

const MONDAY_SLOT: FreedSlot = {
  date: '2026-08-31',
  startTime: '10:00',
  type: 'Destartarização',
  duration: 30,
  dentistId: 'd1',
  chair: 1,
};

test('matchesSlot rejects a treatment type mismatch', () => {
  assert.equal(matchesSlot(candidate({ treatment_type: 'Endodontia' }), MONDAY_SLOT, NOW), false);
});

test('matchesSlot accepts a treatment type match regardless of case/whitespace', () => {
  assert.equal(matchesSlot(candidate({ treatment_type: '  destartarização ' }), MONDAY_SLOT, NOW), true);
});

test('matchesSlot rejects non-active entries', () => {
  assert.equal(matchesSlot(candidate({ status: 'fulfilled' }), MONDAY_SLOT, NOW), false);
});

test('matchesSlot rejects when slot is shorter than the minimum required duration', () => {
  assert.equal(matchesSlot(candidate({ min_duration: 60 }), MONDAY_SLOT, NOW), false);
});

test('matchesSlot rejects a dentist preference mismatch', () => {
  assert.equal(matchesSlot(candidate({ preferred_dentist_id: 'd2' }), MONDAY_SLOT, NOW), false);
});

test('matchesSlot accepts a matching dentist preference', () => {
  assert.equal(matchesSlot(candidate({ preferred_dentist_id: 'd1' }), MONDAY_SLOT, NOW), true);
});

test('matchesSlot rejects slots past max_wait_until', () => {
  assert.equal(matchesSlot(candidate({ max_wait_until: '2026-08-25' }), MONDAY_SLOT, NOW), false);
});

test('matchesSlot rejects slots in the past', () => {
  const pastSlot: FreedSlot = { ...MONDAY_SLOT, date: '2026-08-01' };
  assert.equal(matchesSlot(candidate(), pastSlot, NOW), false);
});

test('matchesSlot filters by preferred weekday', () => {
  // 2026-08-31 is a Monday (weekday 1)
  assert.equal(matchesSlot(candidate({ preferred_days: [2, 3] }), MONDAY_SLOT, NOW), false);
  assert.equal(matchesSlot(candidate({ preferred_days: [1] }), MONDAY_SLOT, NOW), true);
});

test('matchesSlot rejects a slot that overruns the preferred end time', () => {
  const c = candidate({ preferred_time_start: '08:00', preferred_time_end: '10:15' });
  assert.equal(matchesSlot(c, MONDAY_SLOT, NOW), false);
});

test('matchesSlot accepts a slot fully inside the preferred window', () => {
  const c = candidate({ preferred_time_start: '08:00', preferred_time_end: '12:00' });
  assert.equal(matchesSlot(c, MONDAY_SLOT, NOW), true);
});

test('rankCandidates returns only matches, FIFO ordered, capped at limit', () => {
  const candidates = [
    candidate({ id: 'late', created_at: '2026-08-10T00:00:00Z' }),
    candidate({ id: 'early', created_at: '2026-08-01T00:00:00Z' }),
    candidate({ id: 'no-match', min_duration: 999 }),
  ];
  const ranked = rankCandidates(candidates, MONDAY_SLOT, NOW, 3);
  assert.deepEqual(
    ranked.map((c) => c.id),
    ['early', 'late'],
  );
});

test('rankCandidates respects the limit', () => {
  const candidates = [candidate({ id: 'a' }), candidate({ id: 'b' }), candidate({ id: 'c' })];
  const ranked = rankCandidates(candidates, MONDAY_SLOT, NOW, 2);
  assert.equal(ranked.length, 2);
});
