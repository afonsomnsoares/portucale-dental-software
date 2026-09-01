import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNextAction, type NextActionSignals } from '../lib/nextAction.ts';

function signals(overrides: Partial<NextActionSignals> = {}): NextActionSignals {
  return {
    missingFields: [],
    openTaskCount: 0,
    hasUpcomingAppointment: true,
    lifecycleStage: 'stable',
    oldestPendingPlanDays: null,
    ...overrides,
  };
}

test('everything fine -> UP_TO_DATE', () => {
  assert.equal(computeNextAction(signals()).code, 'UP_TO_DATE');
});

test('missing data wins over everything else', () => {
  const action = computeNextAction(
    signals({
      missingFields: [{ field: 'phone', label: 'Telefone' }],
      openTaskCount: 3,
      lifecycleStage: 'inactive',
      hasUpcomingAppointment: false,
    }),
  );
  assert.equal(action.code, 'MISSING_DATA');
  assert.match(action.label, /Telefone/);
});

test('open tasks win over plan/lifecycle/appointment signals once data is complete', () => {
  const action = computeNextAction(
    signals({ openTaskCount: 2, lifecycleStage: 'inactive', hasUpcomingAppointment: false }),
  );
  assert.equal(action.code, 'OPEN_TASKS');
  assert.match(action.label, /2 tarefas/);
});

test('a stale unaccepted plan (>= 14 days) is flagged', () => {
  const action = computeNextAction(signals({ oldestPendingPlanDays: 14 }));
  assert.equal(action.code, 'PLAN_NOT_ACCEPTED');
});

test('a fresh unaccepted plan (< 14 days) does not trigger the plan action', () => {
  const action = computeNextAction(signals({ oldestPendingPlanDays: 5 }));
  assert.equal(action.code, 'UP_TO_DATE');
});

test('inactive lifecycle stage suggests reactivation', () => {
  const action = computeNextAction(signals({ lifecycleStage: 'inactive' }));
  assert.equal(action.code, 'REACTIVATE');
});

test('no upcoming appointment (and not a new patient) suggests booking', () => {
  const action = computeNextAction(signals({ hasUpcomingAppointment: false, lifecycleStage: 'stable' }));
  assert.equal(action.code, 'NO_UPCOMING_VISIT');
});

test('a brand-new patient without an appointment yet is not nagged to book one', () => {
  const action = computeNextAction(signals({ hasUpcomingAppointment: false, lifecycleStage: 'new' }));
  assert.equal(action.code, 'UP_TO_DATE');
});
