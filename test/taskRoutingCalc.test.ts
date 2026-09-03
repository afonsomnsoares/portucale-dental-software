import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_TASK_ROLES,
  type AssigneeCandidate,
  DEFAULT_TASK_ROLES,
  pickAssignee,
  preferredRolesForTaskType,
  rankAssignees,
} from '../lib/taskRoutingCalc.ts';

function candidate(over: Partial<AssigneeCandidate> & { userId: string }): AssigneeCandidate {
  return {
    userName: over.userId,
    role: 'receptionist',
    onShiftNow: true,
    hasShiftToday: true,
    onLeaveToday: false,
    openTaskCount: 0,
    ...over,
  };
}

test('preferredRolesForTaskType: every patient task type routes to reception', () => {
  for (const type of ['generic', 'call', 'document_request', 'data_missing', 'follow_up']) {
    assert.deepEqual(preferredRolesForTaskType(type), ['receptionist']);
  }
});

test('preferredRolesForTaskType: an unknown type falls back to the default roles', () => {
  assert.deepEqual(preferredRolesForTaskType('something_new'), DEFAULT_TASK_ROLES);
  assert.deepEqual(preferredRolesForTaskType(null), DEFAULT_TASK_ROLES);
});

test('pickAssignee: picks the eligible person with the fewest open tasks', () => {
  const candidates = [
    candidate({ userId: 'ana', openTaskCount: 5 }),
    candidate({ userId: 'bruno', openTaskCount: 2 }),
    candidate({ userId: 'carla', openTaskCount: 9 }),
  ];
  assert.equal(pickAssignee(candidates, ['receptionist']), 'bruno');
});

test('pickAssignee: ties break by name, so the same input always gives the same answer', () => {
  const candidates = [
    candidate({ userId: 'u2', userName: 'Zita', openTaskCount: 1 }),
    candidate({ userId: 'u1', userName: 'Ana', openTaskCount: 1 }),
  ];
  assert.equal(pickAssignee(candidates, ['receptionist']), 'u1');
  // Reordering the input must not change the outcome.
  assert.equal(pickAssignee([...candidates].reverse(), ['receptionist']), 'u1');
});

test('pickAssignee: somebody on shift now beats a less-loaded colleague who is off shift', () => {
  const candidates = [
    candidate({ userId: 'off', openTaskCount: 0, onShiftNow: false, hasShiftToday: true }),
    candidate({ userId: 'on', openTaskCount: 7, onShiftNow: true }),
  ];
  assert.equal(pickAssignee(candidates, ['receptionist']), 'on');
});

test('pickAssignee: falls back to someone with a shift today when nobody is on shift right now', () => {
  const candidates = [
    candidate({ userId: 'later', onShiftNow: false, hasShiftToday: true, openTaskCount: 3 }),
    candidate({ userId: 'earlier', onShiftNow: false, hasShiftToday: true, openTaskCount: 1 }),
  ];
  assert.equal(pickAssignee(candidates, ['receptionist']), 'earlier');
});

test('pickAssignee: approved leave excludes someone even when they are the only candidate', () => {
  const candidates = [candidate({ userId: 'ana', onLeaveToday: true })];
  assert.equal(pickAssignee(candidates, ['receptionist']), null);
});

test('pickAssignee: no shift today at all -> stays in the shared queue', () => {
  const candidates = [candidate({ userId: 'ana', onShiftNow: false, hasShiftToday: false })];
  assert.equal(pickAssignee(candidates, ['receptionist']), null);
});

test('pickAssignee: role filter is strict — reception work never lands on a dentist', () => {
  const candidates = [candidate({ userId: 'dr', role: 'dentist', openTaskCount: 0 })];
  assert.equal(pickAssignee(candidates, ['receptionist']), null);
});

test('pickAssignee: admin-routed work (incident escalation) ignores available receptionists', () => {
  const candidates = [
    candidate({ userId: 'rec', role: 'receptionist', openTaskCount: 0 }),
    candidate({ userId: 'adm', role: 'admin', openTaskCount: 4 }),
  ];
  assert.equal(pickAssignee(candidates, ADMIN_TASK_ROLES), 'adm');
});

test('pickAssignee: empty candidate list -> null, not a crash', () => {
  assert.equal(pickAssignee([], ['receptionist']), null);
});

test('rankAssignees: splits on-shift-now from has-shift-today and drops everyone else', () => {
  const candidates = [
    candidate({ userId: 'now', onShiftNow: true }),
    candidate({ userId: 'today', onShiftNow: false, hasShiftToday: true }),
    candidate({ userId: 'absent', onShiftNow: false, hasShiftToday: false }),
    candidate({ userId: 'leave', onLeaveToday: true }),
    candidate({ userId: 'wrongrole', role: 'dentist' }),
  ];
  const ranked = rankAssignees(candidates, ['receptionist']);
  assert.deepEqual(
    ranked.now.map((c) => c.userId),
    ['now'],
  );
  assert.deepEqual(
    ranked.today.map((c) => c.userId),
    ['today'],
  );
});
