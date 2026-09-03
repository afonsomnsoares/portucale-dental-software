import assert from 'node:assert/strict';
import test from 'node:test';
import { __rateLimitStoreSize, __resetRateLimitStore, getClientIp, rateLimit } from '../lib/rateLimit.ts';

// Date.now is stubbed rather than sleeping: the sweep is time-driven (a 60s interval)
// and windows are minutes long, so real waiting would make these tests either slow or
// flaky. Every test restores the original in a finally.
function withClock(startMs: number, fn: (advance: (ms: number) => void) => void) {
  const realNow = Date.now;
  let current = startMs;
  Date.now = () => current;
  try {
    fn((ms) => {
      current += ms;
    });
  } finally {
    Date.now = realNow;
  }
}

test('allows requests up to the limit and blocks the one after', () => {
  __resetRateLimitStore();
  withClock(1_000_000, () => {
    const opts = { limit: 3, windowMs: 60_000 };
    assert.equal(rateLimit('k', opts).ok, true);
    assert.equal(rateLimit('k', opts).ok, true);
    const third = rateLimit('k', opts);
    assert.equal(third.ok, true);
    assert.equal(third.remaining, 0);
    assert.equal(rateLimit('k', opts).ok, false);
  });
});

test('a fresh window restores the budget', () => {
  __resetRateLimitStore();
  withClock(1_000_000, (advance) => {
    const opts = { limit: 2, windowMs: 60_000 };
    rateLimit('k', opts);
    rateLimit('k', opts);
    assert.equal(rateLimit('k', opts).ok, false);

    advance(60_001);
    assert.equal(rateLimit('k', opts).ok, true, 'window elapsed, budget should reset');
  });
});

test('keys are independent', () => {
  __resetRateLimitStore();
  withClock(1_000_000, () => {
    const opts = { limit: 1, windowMs: 60_000 };
    assert.equal(rateLimit('a', opts).ok, true);
    assert.equal(rateLimit('b', opts).ok, true);
    assert.equal(rateLimit('a', opts).ok, false);
  });
});

// The regression this file exists for: entries used to be created and never removed,
// so the store grew by one per distinct caller forever. Anonymous keys carry the
// client IP, so the key space was attacker-controlled.
test('expired entries are swept instead of accumulating', () => {
  __resetRateLimitStore();
  withClock(1_000_000, (advance) => {
    const opts = { limit: 5, windowMs: 30_000 };
    for (let i = 0; i < 500; i += 1) rateLimit(`ip:198.51.100.${i}`, opts);
    assert.equal(__rateLimitStoreSize(), 500);

    // Past every window above, and past the sweep interval.
    advance(120_000);
    rateLimit('ip:203.0.113.1', opts);

    assert.equal(__rateLimitStoreSize(), 1, 'the 500 elapsed windows should be gone');
  });
});

test('sweeping does not drop windows that are still open', () => {
  __resetRateLimitStore();
  withClock(1_000_000, (advance) => {
    const shortWindow = { limit: 5, windowMs: 10_000 };
    const longWindow = { limit: 5, windowMs: 600_000 };
    rateLimit('short', shortWindow);
    rateLimit('long', longWindow);

    advance(70_000); // past `short`'s window and the sweep interval, well inside `long`'s
    rateLimit('trigger', shortWindow);

    // `long` survived, so its count carries over rather than starting again.
    assert.equal(rateLimit('long', longWindow).remaining, 3);
  });
});

test('getClientIp prefers x-forwarded-for and takes the first hop', () => {
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18', 'x-real-ip': '10.0.0.1' });
  assert.equal(getClientIp({ headers }), '203.0.113.5');
});

test('getClientIp falls back through the other proxy headers, then to unknown', () => {
  assert.equal(getClientIp({ headers: new Headers({ 'cf-connecting-ip': '203.0.113.9' }) }), '203.0.113.9');
  assert.equal(getClientIp({ headers: new Headers() }), 'unknown');
});
