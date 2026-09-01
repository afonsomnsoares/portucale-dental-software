import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAvailability,
  detectCoverageGap,
  isOnApprovedLeave,
  isOnShift,
  type RosterCoverageEntry,
  type ScheduleBlock,
  type TimeOffRange,
} from '../lib/staffAvailabilityCalc.ts';

// 2026-08-31 12:00:00 local is a Monday (weekday 1).
const MONDAY_NOON = new Date(2026, 7, 31, 12, 0, 0);
const MONDAY_SHIFT: ScheduleBlock = { weekday: 1, startTime: '09:00', endTime: '18:00' };

test('isOnShift: inside the block on the right weekday -> true', () => {
  assert.equal(isOnShift([MONDAY_SHIFT], MONDAY_NOON), true);
});

test('isOnShift: before the block starts -> false', () => {
  const early = new Date(2026, 7, 31, 8, 0, 0);
  assert.equal(isOnShift([MONDAY_SHIFT], early), false);
});

test('isOnShift: exactly at end_time -> false (end is exclusive)', () => {
  const atEnd = new Date(2026, 7, 31, 18, 0, 0);
  assert.equal(isOnShift([MONDAY_SHIFT], atEnd), false);
});

test('isOnShift: exactly at start_time -> true (start is inclusive)', () => {
  const atStart = new Date(2026, 7, 31, 9, 0, 0);
  assert.equal(isOnShift([MONDAY_SHIFT], atStart), true);
});

test('isOnShift: right weekday somewhere else has no effect on a different weekday', () => {
  const tuesday = new Date(2026, 8, 1, 12, 0, 0); // Tuesday
  assert.equal(isOnShift([MONDAY_SHIFT], tuesday), false);
});

test('isOnShift: split shift (two blocks, same weekday) — the lunch gap is unavailable', () => {
  const blocks: ScheduleBlock[] = [
    { weekday: 1, startTime: '09:00', endTime: '13:00' },
    { weekday: 1, startTime: '14:00', endTime: '18:00' },
  ];
  const duringLunch = new Date(2026, 7, 31, 13, 30, 0);
  const afterLunch = new Date(2026, 7, 31, 15, 0, 0);
  assert.equal(isOnShift(blocks, duringLunch), false);
  assert.equal(isOnShift(blocks, afterLunch), true);
});

test('isOnApprovedLeave: date inside an approved range -> true', () => {
  const ranges: TimeOffRange[] = [{ startDate: '2026-09-01', endDate: '2026-09-05', status: 'approved' }];
  assert.equal(isOnApprovedLeave(ranges, '2026-09-03'), true);
});

test('isOnApprovedLeave: boundaries are inclusive', () => {
  const ranges: TimeOffRange[] = [{ startDate: '2026-09-01', endDate: '2026-09-05', status: 'approved' }];
  assert.equal(isOnApprovedLeave(ranges, '2026-09-01'), true);
  assert.equal(isOnApprovedLeave(ranges, '2026-09-05'), true);
  assert.equal(isOnApprovedLeave(ranges, '2026-08-31'), false);
  assert.equal(isOnApprovedLeave(ranges, '2026-09-06'), false);
});

test('isOnApprovedLeave: a pending request does not block availability', () => {
  const ranges: TimeOffRange[] = [{ startDate: '2026-09-01', endDate: '2026-09-05', status: 'pending' }];
  assert.equal(isOnApprovedLeave(ranges, '2026-09-03'), false);
});

test('isOnApprovedLeave: a rejected request does not block availability', () => {
  const ranges: TimeOffRange[] = [{ startDate: '2026-09-01', endDate: '2026-09-05', status: 'rejected' }];
  assert.equal(isOnApprovedLeave(ranges, '2026-09-03'), false);
});

test('computeAvailability: on shift, no leave -> available', () => {
  const result = computeAvailability([MONDAY_SHIFT], [], MONDAY_NOON);
  assert.deepEqual(result, { onShift: true, onLeave: false, available: true });
});

test('computeAvailability: on shift, but on approved leave that day -> not available', () => {
  const ranges: TimeOffRange[] = [{ startDate: '2026-08-31', endDate: '2026-08-31', status: 'approved' }];
  const result = computeAvailability([MONDAY_SHIFT], ranges, MONDAY_NOON);
  assert.deepEqual(result, { onShift: true, onLeave: true, available: false });
});

test('computeAvailability: off shift entirely -> not available regardless of leave', () => {
  const sunday = new Date(2026, 7, 30, 12, 0, 0);
  const result = computeAvailability([MONDAY_SHIFT], [], sunday);
  assert.deepEqual(result, { onShift: false, onLeave: false, available: false });
});

test('detectCoverageGap: flags a role where everyone is off-shift or on leave', () => {
  const entries: RosterCoverageEntry[] = [
    { role: 'dentist', hasShiftToday: false, onLeaveToday: false },
    { role: 'dentist', hasShiftToday: true, onLeaveToday: true },
    { role: 'receptionist', hasShiftToday: true, onLeaveToday: false },
  ];
  assert.deepEqual(detectCoverageGap(entries, ['dentist', 'receptionist']), ['dentist']);
});

test('detectCoverageGap: a role with nobody on the roster at all is not flagged', () => {
  const entries: RosterCoverageEntry[] = [{ role: 'receptionist', hasShiftToday: true, onLeaveToday: false }];
  assert.deepEqual(detectCoverageGap(entries, ['dentist', 'receptionist']), []);
});

test('detectCoverageGap: covered when at least one person of the role is working and not on leave', () => {
  const entries: RosterCoverageEntry[] = [
    { role: 'dentist', hasShiftToday: true, onLeaveToday: true },
    { role: 'dentist', hasShiftToday: true, onLeaveToday: false },
  ];
  assert.deepEqual(detectCoverageGap(entries, ['dentist']), []);
});
