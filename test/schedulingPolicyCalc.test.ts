import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POLICY,
  isQuietHour,
  normalizePolicy,
  offerExpiryAt,
  policyAutoBooks,
  policyContacts,
  type SchedulingPolicy,
} from '../lib/schedulingPolicyCalc.ts';

function policy(overrides: Partial<SchedulingPolicy> = {}): SchedulingPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

test('normalizePolicy falls back to the defaults when no row exists', () => {
  assert.deepEqual(normalizePolicy(null), DEFAULT_POLICY);
});

test('normalizePolicy defaults to propose — an upgrade never starts contacting patients on its own', () => {
  assert.equal(DEFAULT_POLICY.mode, 'propose');
  assert.equal(policyContacts(DEFAULT_POLICY), false);
  assert.equal(policyAutoBooks(DEFAULT_POLICY), false);
});

test('normalizePolicy clamps out-of-range values instead of trusting them', () => {
  const p = normalizePolicy({ max_offers_per_slot: 99, min_score: -5, horizon_days: 900, daily_contact_cap: 4000 });
  assert.equal(p.maxOffersPerSlot, 10);
  assert.equal(p.minScore, 0);
  assert.equal(p.horizonDays, 60);
  assert.equal(p.dailyContactCap, 1000);
});

test('normalizePolicy rejects an unknown mode', () => {
  assert.equal(normalizePolicy({ mode: 'yolo' }).mode, DEFAULT_POLICY.mode);
});

test('normalizePolicy keeps an explicitly empty source list', () => {
  assert.deepEqual(normalizePolicy({ allowed_sources: [] }).allowedSources, []);
});

test('normalizePolicy accepts camelCase input (a PUT body before it is stored)', () => {
  const p = normalizePolicy({ mode: 'autobook', maxOffersPerSlot: 2, allowedSources: ['waitlist'] });
  assert.equal(p.mode, 'autobook');
  assert.equal(p.maxOffersPerSlot, 2);
  assert.deepEqual(p.allowedSources, ['waitlist']);
});

test('policyContacts/policyAutoBooks follow the autonomy ladder', () => {
  assert.equal(policyContacts(policy({ mode: 'off' })), false);
  assert.equal(policyContacts(policy({ mode: 'propose' })), false);
  assert.equal(policyContacts(policy({ mode: 'contact' })), true);
  assert.equal(policyContacts(policy({ mode: 'autobook' })), true);
  assert.equal(policyAutoBooks(policy({ mode: 'contact' })), false);
  assert.equal(policyAutoBooks(policy({ mode: 'autobook' })), true);
});

test('isQuietHour handles the overnight window', () => {
  assert.equal(isQuietHour(22, 21, 9), true);
  assert.equal(isQuietHour(3, 21, 9), true);
  assert.equal(isQuietHour(9, 21, 9), false);
  assert.equal(isQuietHour(14, 21, 9), false);
});

test('isQuietHour handles a same-day window', () => {
  assert.equal(isQuietHour(13, 12, 14), true);
  assert.equal(isQuietHour(15, 12, 14), false);
});

test('isQuietHour treats a degenerate window as no quiet hours at all', () => {
  assert.equal(isQuietHour(3, 9, 9), false);
});

test('offerExpiryAt never outlives the slot it offers', () => {
  const now = new Date('2026-09-03T18:00:00Z');
  // A vaga é daqui a 3h; a política diz 24h. Vence a vaga.
  const soon = offerExpiryAt(policy({ offerExpiryHours: 24 }), new Date('2026-09-03T21:00:00Z'), now);
  assert.equal(soon?.expiresAt.toISOString(), '2026-09-03T21:00:00.000Z');
  assert.equal(soon?.hours, 3);
});

test('offerExpiryAt uses the policy window when the slot is far away', () => {
  const now = new Date('2026-09-03T18:00:00Z');
  const later = offerExpiryAt(policy({ offerExpiryHours: 6 }), new Date('2026-09-10T09:00:00Z'), now);
  assert.equal(later?.hours, 6);
});

test('offerExpiryAt refuses a slot already in the past', () => {
  const now = new Date('2026-09-03T18:00:00Z');
  assert.equal(offerExpiryAt(DEFAULT_POLICY, new Date('2026-09-03T17:00:00Z'), now), null);
});
