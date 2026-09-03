import assert from 'node:assert/strict';
import test from 'node:test';
import { getR2Config, presignPutObjectR2 } from '../lib/r2.ts';

test('r2 config is null when env vars are missing', () => {
  const cfg = getR2Config();
  assert.equal(cfg, null);
});

test('presign returns null when r2 is not configured', () => {
  const res = presignPutObjectR2({ key: 'x.bin', contentType: 'image/png', contentLength: 1024 });
  assert.equal(res, null);
});

// The presign path used to sign only `host`, which meant the Content-Type it handed
// back was a suggestion the caller could ignore and the size was unbounded — the two
// limits app/api/uploads/route.ts enforces did not exist on this route at all. These
// tests pin the signature down to both headers, since that is what makes R2 (rather
// than a cooperative client) do the rejecting.
test('presign signs content-type and content-length, not just host', () => {
  process.env.R2_ENDPOINT = 'https://accountid.r2.cloudflarestorage.com';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.R2_ACCESS_KEY_ID = 'AKIAtest';
  process.env.R2_SECRET_ACCESS_KEY = 'secrettest';
  try {
    const res = presignPutObjectR2({ key: 'tenant/file.png', contentType: 'image/png', contentLength: 2048 });
    assert.ok(res, 'expected a presigned result');

    const signedHeaders = new URL(res.uploadUrl).searchParams.get('X-Amz-SignedHeaders');
    assert.equal(signedHeaders, 'content-length;content-type;host');

    // Returned verbatim so the caller sends exactly what was signed — anything else
    // and the PUT fails the signature check.
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.equal(res.headers['Content-Length'], '2048');
  } finally {
    // `= undefined` would store the literal string "undefined" and leave R2 looking
    // configured for every test that runs after this one.
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  }
});

test('a different content-length produces a different signature', () => {
  process.env.R2_ENDPOINT = 'https://accountid.r2.cloudflarestorage.com';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.R2_ACCESS_KEY_ID = 'AKIAtest';
  process.env.R2_SECRET_ACCESS_KEY = 'secrettest';
  try {
    const small = presignPutObjectR2({ key: 'tenant/f.png', contentType: 'image/png', contentLength: 1000 });
    const large = presignPutObjectR2({ key: 'tenant/f.png', contentType: 'image/png', contentLength: 9_000_000 });
    assert.ok(small && large);

    const sigOf = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');
    assert.notEqual(sigOf(small.uploadUrl), sigOf(large.uploadUrl));
  } finally {
    // `= undefined` would store the literal string "undefined" and leave R2 looking
    // configured for every test that runs after this one.
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  }
});
