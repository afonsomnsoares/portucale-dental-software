import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describePreferences,
  hasAnyPreference,
  preferenceFit,
  type SchedulingPreferences,
  weekdayOfDate,
} from '../lib/schedulingPrefsCalc.ts';

const NONE: SchedulingPreferences = {
  preferredDentistId: null,
  preferredDays: null,
  preferredTimeStart: null,
  preferredTimeEnd: null,
};
// 2026-03-02 é uma segunda-feira (weekday 1).
const MONDAY = '2026-03-02';
const SATURDAY = '2026-03-07';

test('weekdayOfDate reads the calendar day in UTC, not local time', () => {
  assert.equal(weekdayOfDate(MONDAY), 1);
  assert.equal(weekdayOfDate(SATURDAY), 6);
});

test('hasAnyPreference: empty profile is treated as no preferences', () => {
  assert.equal(hasAnyPreference(NONE), false);
  assert.equal(hasAnyPreference(null), false);
  assert.equal(hasAnyPreference({ ...NONE, preferredDays: [] }), false);
  assert.equal(hasAnyPreference({ ...NONE, preferredDays: [1] }), true);
  assert.equal(hasAnyPreference({ ...NONE, preferredTimeStart: '09:00' }), true);
  assert.equal(hasAnyPreference({ ...NONE, preferredDentistId: 'd1' }), true);
});

test('preferenceFit: no preferences -> satisfied, nothing applicable', () => {
  const fit = preferenceFit(NONE, { date: MONDAY, startMinutes: 600, durationMinutes: 30, dentistId: 'd1' });
  assert.deepEqual(fit, { score: 0, applicable: 0, violations: [], satisfied: true });
});

test('preferenceFit: matching weekday scores and reports no violation', () => {
  const fit = preferenceFit({ ...NONE, preferredDays: [1, 3] }, {
    date: MONDAY,
    startMinutes: 600,
    durationMinutes: 30,
    dentistId: null,
  });
  assert.equal(fit.score, 1);
  assert.equal(fit.applicable, 1);
  assert.equal(fit.satisfied, true);
});

test('preferenceFit: wrong weekday reports a readable violation naming both sides', () => {
  const fit = preferenceFit({ ...NONE, preferredDays: [1, 3] }, {
    date: SATURDAY,
    startMinutes: 600,
    durationMinutes: 30,
    dentistId: null,
  });
  assert.equal(fit.score, 0);
  assert.equal(fit.satisfied, false);
  assert.match(fit.violations[0], /Sábado/);
  assert.match(fit.violations[0], /Segunda, Quarta/);
});

test('preferenceFit: the appointment must fit entirely inside the time window', () => {
  const prefs = { ...NONE, preferredTimeStart: '09:00', preferredTimeEnd: '12:00' };
  const inside = preferenceFit(prefs, { date: MONDAY, startMinutes: 600, durationMinutes: 30, dentistId: null });
  assert.equal(inside.satisfied, true);
  // Starts at 11:45 but runs to 12:15 — spilling past the window is a violation.
  const overruns = preferenceFit(prefs, { date: MONDAY, startMinutes: 705, durationMinutes: 30, dentistId: null });
  assert.equal(overruns.satisfied, false);
  assert.match(overruns.violations[0], /janela horária/);
});

test('preferenceFit: an open-ended window only constrains the side that was set', () => {
  const morningOnly = { ...NONE, preferredTimeEnd: '13:00' };
  assert.equal(
    preferenceFit(morningOnly, { date: MONDAY, startMinutes: 540, durationMinutes: 60, dentistId: null }).satisfied,
    true,
  );
  assert.equal(
    preferenceFit(morningOnly, { date: MONDAY, startMinutes: 900, durationMinutes: 30, dentistId: null }).satisfied,
    false,
  );
});

test('preferenceFit: dentist preference matches only that dentist', () => {
  const prefs = { ...NONE, preferredDentistId: 'd1' };
  assert.equal(
    preferenceFit(prefs, { date: MONDAY, startMinutes: 600, durationMinutes: 30, dentistId: 'd1' }).satisfied,
    true,
  );
  const wrong = preferenceFit(prefs, { date: MONDAY, startMinutes: 600, durationMinutes: 30, dentistId: 'd2' });
  assert.equal(wrong.satisfied, false);
  assert.deepEqual(wrong.violations, ['Não é o dentista preferido']);
});

test('preferenceFit: an unassigned appointment does not satisfy a dentist preference', () => {
  const fit = preferenceFit({ ...NONE, preferredDentistId: 'd1' }, {
    date: MONDAY,
    startMinutes: 600,
    durationMinutes: 30,
    dentistId: null,
  });
  assert.equal(fit.satisfied, false);
});

test('preferenceFit: applicable counts only what the patient actually set', () => {
  // One criterion set, one met -> perfect, even though other criteria exist.
  const onlyDays = preferenceFit({ ...NONE, preferredDays: [1] }, {
    date: MONDAY,
    startMinutes: 600,
    durationMinutes: 30,
    dentistId: null,
  });
  assert.deepEqual([onlyDays.score, onlyDays.applicable], [1, 1]);

  const allThree = preferenceFit(
    { preferredDays: [1], preferredTimeStart: '09:00', preferredTimeEnd: '12:00', preferredDentistId: 'd1' },
    { date: MONDAY, startMinutes: 600, durationMinutes: 30, dentistId: 'd1' },
  );
  assert.deepEqual([allThree.score, allThree.applicable, allThree.satisfied], [3, 3, true]);
});

test('preferenceFit: partial match collects every violation, not just the first', () => {
  const fit = preferenceFit(
    { preferredDays: [1], preferredTimeStart: '09:00', preferredTimeEnd: '12:00', preferredDentistId: 'd1' },
    { date: SATURDAY, startMinutes: 900, durationMinutes: 30, dentistId: 'd2' },
  );
  assert.equal(fit.score, 0);
  assert.equal(fit.violations.length, 3);
});

test('describePreferences: renders a compact human summary', () => {
  assert.equal(
    describePreferences({ ...NONE, preferredDays: [1, 5], preferredTimeStart: '09:00', preferredTimeEnd: '13:00' }),
    'Segunda, Sexta · 09:00–13:00',
  );
  assert.equal(describePreferences({ ...NONE, preferredDentistId: 'd1' }, 'Dra. Silva'), 'com Dra. Silva');
  assert.equal(describePreferences(NONE), '');
  assert.equal(describePreferences(null), '');
});
