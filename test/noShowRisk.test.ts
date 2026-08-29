import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateByWeekdayHour,
  clamp01,
  hourBucketFor,
  leadTimeFactor,
  rateFor,
  ratesByHourBucket,
  ratesByWeekday,
  riskScore,
} from '../lib/noShowRisk.ts';

test('clamp01 bounds and coerces', () => {
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01('abc'), 0);
  assert.equal(clamp01(0.4), 0.4);
});

test('hourBucketFor maps hours to the right bucket', () => {
  assert.equal(hourBucketFor(9), 'morning');
  assert.equal(hourBucketFor(14), 'afternoon');
  assert.equal(hourBucketFor(18), 'evening');
  assert.equal(hourBucketFor(23), 'evening'); // falls back to last bucket
});

test('leadTimeFactor ramps 0->1 over 21 days then flattens', () => {
  assert.equal(leadTimeFactor(0), 0);
  assert.equal(leadTimeFactor(21), 1);
  assert.equal(leadTimeFactor(100), 1);
  assert.equal(leadTimeFactor(-5), 0);
});

test('riskScore is 0 for a clean-history patient with no lead time', () => {
  const { score } = riskScore({ patientNoShowRate: 0, patientCancelRate: 0, weekdayBaseRate: 0, hourBaseRate: 0 });
  assert.equal(score, 0);
});

test('riskScore is 100 for a worst-case patient', () => {
  const { score } = riskScore({
    patientNoShowRate: 1,
    patientCancelRate: 1,
    weekdayBaseRate: 1,
    hourBaseRate: 1,
    leadTimeDays: 30,
    isFirstVisit: true,
  });
  assert.equal(score, 100);
});

test('riskScore weighs patient history more than a single factor', () => {
  const highHistory = riskScore({ patientNoShowRate: 1 }).score;
  const highLeadOnly = riskScore({ leadTimeDays: 30 }).score;
  assert.ok(highHistory > highLeadOnly);
});

test('riskScore exposes per-factor contributions that sum to the raw score', () => {
  const { contributions, factors } = riskScore({ patientNoShowRate: 0.5, leadTimeDays: 10 });
  assert.ok(contributions.patientNoShowRate > 0);
  assert.equal(factors.patientNoShowRate, 0.5);
});

test('aggregateByWeekdayHour rates no-shows/cancellations against total, ignores attended', () => {
  const rows = [
    { appt_date: '2026-08-24', start_time: '09:00', outcome: 'no-show' as const }, // Monday morning
    { appt_date: '2026-08-24', start_time: '09:30', outcome: 'attended' as const },
    { appt_date: '2026-08-31', start_time: '09:15', outcome: 'cancelled' as const }, // another Monday morning
  ];
  const cells = aggregateByWeekdayHour(rows);
  const mondayMorning = cells.find((c) => c.weekday === 1 && c.bucket === 'morning');
  assert.ok(mondayMorning);
  assert.equal(mondayMorning?.total, 3);
  assert.equal(mondayMorning?.risky, 2);
  assert.ok(Math.abs((mondayMorning?.rate || 0) - 2 / 3) < 1e-9);
});

test('aggregateByWeekdayHour sorts by rate descending', () => {
  const rows = [
    { appt_date: '2026-08-24', start_time: '09:00', outcome: 'no-show' as const },
    { appt_date: '2026-08-25', start_time: '14:00', outcome: 'attended' as const },
    { appt_date: '2026-08-25', start_time: '14:10', outcome: 'attended' as const },
  ];
  const cells = aggregateByWeekdayHour(rows);
  assert.equal(cells[0].rate, 1);
  assert.ok(cells[0].rate >= cells[1].rate);
});

test('rateFor returns 0 when no matching cell exists', () => {
  assert.equal(rateFor([], 3, 'afternoon'), 0);
});

test('ratesByWeekday collapses hour buckets into one rate per weekday', () => {
  const rows = [
    { appt_date: '2026-08-24', start_time: '09:00', outcome: 'no-show' as const }, // Mon morning
    { appt_date: '2026-08-24', start_time: '14:00', outcome: 'attended' as const }, // Mon afternoon
  ];
  const rates = ratesByWeekday(rows);
  assert.equal(rates.get(1), 0.5); // 1 risky out of 2, both Monday
});

test('ratesByHourBucket collapses weekdays into one rate per hour bucket', () => {
  const rows = [
    { appt_date: '2026-08-24', start_time: '09:00', outcome: 'no-show' as const }, // morning
    { appt_date: '2026-08-31', start_time: '09:30', outcome: 'attended' as const }, // morning, different Monday
  ];
  const rates = ratesByHourBucket(rows);
  assert.equal(rates.get('morning'), 0.5);
});
