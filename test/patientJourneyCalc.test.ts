import assert from 'node:assert/strict';
import test from 'node:test';
import { computeJourneyStage, JOURNEY_STAGES, type JourneySignals } from '../lib/patientJourneyCalc.ts';

function signals(overrides: Partial<JourneySignals> = {}): JourneySignals {
  return {
    visitCount: 0,
    hasFutureAppointment: false,
    hasOpenTreatment: false,
    hasCompletedTreatment: false,
    hasOpenPlan: false,
    hasAcceptedPlanNoTreatment: false,
    recallDue: false,
    ...overrides,
  };
}

test('JOURNEY_STAGES lists exactly the 8 patient stages in pipeline order', () => {
  assert.deepEqual(
    JOURNEY_STAGES.map((s) => s.key),
    [
      'booked',
      'first_visit_done',
      'plan_presented',
      'plan_accepted',
      'in_treatment',
      'completed',
      'recall_due',
      'booked_again',
    ],
  );
});

test('never visited, nothing scheduled -> booked', () => {
  assert.equal(computeJourneyStage(signals()), 'booked');
});

test('never visited but has a future appointment -> still booked (first visit not done yet)', () => {
  assert.equal(computeJourneyStage(signals({ hasFutureAppointment: true })), 'booked');
});

test('visited once, nothing else going on -> first_visit_done', () => {
  assert.equal(computeJourneyStage(signals({ visitCount: 1 })), 'first_visit_done');
});

test('an open (unapproved) treatment plan -> plan_presented', () => {
  assert.equal(computeJourneyStage(signals({ visitCount: 1, hasOpenPlan: true })), 'plan_presented');
});

test('an approved plan with no treatment started yet -> plan_accepted', () => {
  assert.equal(
    computeJourneyStage(signals({ visitCount: 1, hasAcceptedPlanNoTreatment: true })),
    'plan_accepted',
  );
});

test('an open treatment wins over a newer plan being proposed in parallel', () => {
  const stage = computeJourneyStage(
    signals({ visitCount: 2, hasOpenTreatment: true, hasOpenPlan: true, hasAcceptedPlanNoTreatment: true }),
  );
  assert.equal(stage, 'in_treatment');
});

test('already booked again wins over a merely-overdue recall', () => {
  const stage = computeJourneyStage(
    signals({ visitCount: 3, hasCompletedTreatment: true, recallDue: true, hasFutureAppointment: true }),
  );
  assert.equal(stage, 'booked_again');
});

test('overdue recall with nothing else pending and no future visit -> recall_due', () => {
  const stage = computeJourneyStage(signals({ visitCount: 3, hasCompletedTreatment: true, recallDue: true }));
  assert.equal(stage, 'recall_due');
});

test('a recall row on a patient who never actually visited does not produce recall_due', () => {
  // Seed/import data can attach a recalls row ahead of an actual first visit — that's
  // not a real "overdue checkup", so it must fall through to the never-visited bucket.
  const stage = computeJourneyStage(signals({ visitCount: 0, recallDue: true }));
  assert.equal(stage, 'booked');
});

test('completed treatment, no recall due, nothing else pending -> completed', () => {
  const stage = computeJourneyStage(signals({ visitCount: 2, hasCompletedTreatment: true }));
  assert.equal(stage, 'completed');
});

test('a future appointment alone (no prior visit) never produces booked_again', () => {
  const stage = computeJourneyStage(signals({ visitCount: 0, hasFutureAppointment: true, hasCompletedTreatment: true }));
  // hasCompletedTreatment true with visitCount 0 is a contradiction in real data, but the
  // function should still resolve deterministically off the signals it's given.
  assert.equal(stage, 'completed');
});
