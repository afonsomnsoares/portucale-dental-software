import test from 'node:test';
import assert from 'node:assert/strict';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

test('jwt includes exp and expires', async () => {
  process.env.JWT_SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.JWT_TTL_SECONDS = '1';
  const { signToken, verifyToken } = await import(`../lib/auth.ts?x=${Math.random()}`);
  const t = signToken({ id: 'u1', role: 'admin' });
  const p1 = verifyToken(t);
  assert.equal(p1.id, 'u1');
  assert.ok(typeof p1.exp === 'number');
  await sleep(2100);
  const p2 = verifyToken(t);
  assert.equal(p2, null);
});

test('jwt verification supports multiple secrets (rotation)', async () => {
  process.env.JWT_SECRET = 'old-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const a = await import(`../lib/auth.ts?x=${Math.random()}`);
  const token = a.signToken({ id: 'u2', role: 'admin' });

  process.env.JWT_SECRET = '';
  process.env.JWT_SECRETS = 'new-secret-cccccccccccccccccccccccccccccccc,old-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const b = await import(`../lib/auth.ts?x=${Math.random()}`);
  const p = b.verifyToken(token);
  assert.equal(p.id, 'u2');
});
