import test from 'node:test';
import assert from 'node:assert/strict';
import { getR2Config, presignPutObjectR2 } from '../lib/r2.ts';

test('r2 config is null when env vars are missing', () => {
  const cfg = getR2Config();
  assert.equal(cfg, null);
});

test('presign returns null when r2 is not configured', () => {
  const res = presignPutObjectR2({ key: 'x.bin', contentType: 'application/octet-stream' });
  assert.equal(res, null);
});

