import assert from 'node:assert/strict';
import test from 'node:test';
import { pctChange, planConversionRate, previousPeriodRange } from '../lib/reportsCalc.ts';

test('pctChange computes a relative delta', () => {
  assert.equal(pctChange(110, 100), 0.1);
  assert.equal(pctChange(90, 100), -0.1);
  assert.equal(pctChange(100, 100), 0);
});

test('pctChange returns null when previous is 0 or inputs are not finite', () => {
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(Number.NaN, 100), null);
  assert.equal(pctChange(100, undefined), null);
});

test('previousPeriodRange returns the immediately-preceding window of the same length', () => {
  assert.deepEqual(previousPeriodRange('2026-08-01', '2026-08-24'), {
    from: '2026-07-08',
    to: '2026-07-31',
  });
});

test('previousPeriodRange handles a single-day range', () => {
  assert.deepEqual(previousPeriodRange('2026-08-24', '2026-08-24'), {
    from: '2026-08-23',
    to: '2026-08-23',
  });
});

test('planConversionRate divides accepted by presented value', () => {
  assert.equal(planConversionRate(218000, 126000), 126000 / 218000);
});

test('planConversionRate is 0 when nothing was presented', () => {
  assert.equal(planConversionRate(0, 0), 0);
  assert.equal(planConversionRate(null, 500), 0);
});
