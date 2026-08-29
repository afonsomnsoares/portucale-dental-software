import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECOVERY_DEFAULTS,
  avgFee,
  businessDays,
  freeSlots,
  monthStart,
  recoveryValue,
  roundEUR,
} from '../lib/recoveryCalc.ts';

const FRI = new Date('2026-08-21T12:00:00Z');

test('roundEUR rounds to 2 decimals', () => {
  assert.equal(roundEUR(10.005), 10.01);
  assert.equal(roundEUR('1234.567'), 1234.57);
  assert.equal(roundEUR(NaN), 0);
  assert.equal(roundEUR(undefined), 0);
});

test('avgFee ignores invalid values and falls back', () => {
  assert.equal(avgFee([30, '50', 40], 99), 40);
  assert.equal(avgFee([null, -5, 'abc'], 99), 99);
  assert.equal(avgFee([], 45), 45);
});

test('recoveryValue calculates and rounds opportunity value', () => {
  assert.equal(recoveryValue(3, 45), 135);
  assert.equal(recoveryValue(2, 45.125), 90.25);
  assert.equal(recoveryValue(0, 45), 0);
});

test('recoveryValue ignores invalid and negative inputs', () => {
  assert.equal(recoveryValue(-2, 45), 0);
  assert.equal(recoveryValue('invalid', 45), 0);
  assert.equal(recoveryValue(2, -45), 0);
  assert.equal(recoveryValue(2, undefined), 0);
});

test('businessDays counts only weekdays', () => {
  assert.equal(businessDays(7, FRI), 5);
  assert.equal(businessDays(1, FRI), 1);
  const SAT = new Date('2026-08-22T12:00:00Z');
  assert.equal(businessDays(2, SAT), 0);
  assert.equal(businessDays(0, FRI), 0);
});

test('freeSlots computes capacity minus booked minutes', () => {
  const slots = freeSlots(2, 600, 7, 480, 30, FRI);
  assert.equal(slots, 140);
});

test('freeSlots never returns negative', () => {
  assert.equal(freeSlots(1, 100000, 7, 480, 30, FRI), 0);
  assert.equal(freeSlots(0, 0, 7, 480, 30, FRI), 0);
});

test('defaults are sane', () => {
  assert.ok(RECOVERY_DEFAULTS.slotMinutes > 0);
  assert.ok(RECOVERY_DEFAULTS.workMinutesPerDay > 0);
  assert.ok(RECOVERY_DEFAULTS.inactiveMonths > 0);
  assert.equal(RECOVERY_DEFAULTS.cancelledWindowDays, RECOVERY_DEFAULTS.noShowWindowDays);
});

test('monthStart returns first day of current month', () => {
  assert.match(monthStart(new Date('2026-08-21T10:00:00Z')), /^2026-08-01$/);
});
