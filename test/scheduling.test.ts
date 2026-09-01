import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  DEFAULT_APPOINTMENT_DURATION,
  freeIntervals,
  generateSlotStarts,
  getDefaultDuration,
  getWorkingWindows,
  isOnLeave,
  minutesToTime,
  pickFreeChair,
  rankSlotCandidates,
  toMinutes,
  weekdayOf,
} from '../lib/scheduling.ts';

test('toMinutes / minutesToTime round-trip', () => {
  assert.equal(toMinutes('09:00'), 540);
  assert.equal(toMinutes('09:00:00'), 540);
  assert.equal(minutesToTime(540), '09:00');
  assert.equal(minutesToTime(75), '01:15');
});

test('addDays / weekdayOf', () => {
  assert.equal(addDays('2026-03-02', 3), '2026-03-05');
  assert.equal(weekdayOf('2026-03-02'), 1); // Monday
});

test('getDefaultDuration falls back for unknown types', () => {
  assert.equal(getDefaultDuration('Root Canal'), 60);
  assert.equal(getDefaultDuration('Something Made Up'), DEFAULT_APPOINTMENT_DURATION);
});

test('getWorkingWindows filters by weekday and supports split shifts', () => {
  const shifts = [
    { weekday: 1, start_time: '09:00', end_time: '13:00' },
    { weekday: 1, start_time: '14:00', end_time: '18:00' },
    { weekday: 2, start_time: '09:00', end_time: '18:00' },
  ];
  assert.deepEqual(getWorkingWindows(1, shifts), [
    { start: 540, end: 780 },
    { start: 840, end: 1080 },
  ]);
  assert.deepEqual(getWorkingWindows(3, shifts), []);
});

test('isOnLeave checks inclusive date ranges', () => {
  const timeOff = [{ start_date: '2026-03-10', end_date: '2026-03-14' }];
  assert.equal(isOnLeave('2026-03-10', timeOff), true);
  assert.equal(isOnLeave('2026-03-14', timeOff), true);
  assert.equal(isOnLeave('2026-03-09', timeOff), false);
  assert.equal(isOnLeave('2026-03-15', timeOff), false);
});

test('freeIntervals: no bookings leaves the whole window free', () => {
  const windows = [{ start: 540, end: 780 }]; // 09:00-13:00
  assert.deepEqual(freeIntervals(windows, [], 30), [{ start: 540, end: 780 }]);
});

test('freeIntervals: a booking in the middle splits the window', () => {
  const windows = [{ start: 540, end: 780 }]; // 09:00-13:00
  const busy = [{ start: 600, end: 660 }]; // 10:00-11:00
  assert.deepEqual(freeIntervals(windows, busy, 30), [
    { start: 540, end: 600 },
    { start: 660, end: 780 },
  ]);
});

test('freeIntervals: bookings touching the edges leave only the middle, respecting minDuration', () => {
  const windows = [{ start: 540, end: 780 }]; // 09:00-13:00
  const busy = [
    { start: 540, end: 570 }, // 09:00-09:30
    { start: 750, end: 780 }, // 12:30-13:00
  ];
  assert.deepEqual(freeIntervals(windows, busy, 30), [{ start: 570, end: 750 }]);
  // With a 4h minimum, the remaining 3h gap no longer qualifies.
  assert.deepEqual(freeIntervals(windows, busy, 240), []);
});

test('freeIntervals: fully booked window yields nothing', () => {
  const windows = [{ start: 540, end: 780 }];
  const busy = [{ start: 540, end: 780 }];
  assert.deepEqual(freeIntervals(windows, busy, 15), []);
});

test('generateSlotStarts snaps to the grid and fits duration', () => {
  assert.deepEqual(generateSlotStarts({ start: 545, end: 630 }, 30, 15), [555, 570, 585, 600]);
  assert.deepEqual(generateSlotStarts({ start: 540, end: 560 }, 30, 15), []);
});

test('pickFreeChair returns the first free chair, or null if all are taken', () => {
  const existing = [
    { chair: 1, start: 540, end: 570 }, // 09:00-09:30
    { chair: 2, start: 540, end: 600 }, // 09:00-10:00
  ];
  // 09:00-09:30: chairs 1 and 2 both busy -> chair 3 is the first free one
  assert.equal(pickFreeChair(existing, 540, 30, 3), 3);
  // same window, but only 2 chairs exist -> none free
  assert.equal(pickFreeChair(existing, 540, 30, 2), null);
  // 09:30-10:00: chair 1 freed up at 09:30, chair 2 is still busy until 10:00
  assert.equal(pickFreeChair(existing, 570, 30, 2), 1);
});

test('rankSlotCandidates prefers a day the patient already has an appointment on', () => {
  const candidates = [
    { dentistId: 'a', dentistName: 'Dr. A', chair: 1, date: '2026-03-02', startMinutes: 540 },
    { dentistId: 'b', dentistName: 'Dr. B', chair: 2, date: '2026-03-05', startMinutes: 540 },
  ];
  const ranked = rankSlotCandidates(candidates, { patientAppointmentDates: ['2026-03-05'] });
  assert.equal(ranked[0].date, '2026-03-05');
  assert.equal(ranked[1].date, '2026-03-02');
});

test('rankSlotCandidates falls back to earliest-first with no patient context', () => {
  const candidates = [
    { dentistId: 'a', dentistName: 'Dr. A', chair: 1, date: '2026-03-05', startMinutes: 540 },
    { dentistId: 'b', dentistName: 'Dr. B', chair: 2, date: '2026-03-02', startMinutes: 600 },
  ];
  const ranked = rankSlotCandidates(candidates);
  assert.equal(ranked[0].date, '2026-03-02');
});
