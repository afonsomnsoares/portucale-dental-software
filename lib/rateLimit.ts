interface RateRecord {
  resetAt: number;
  count: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, RateRecord> | undefined;
}

function getStore() {
  const g = globalThis;
  if (!g.__rateLimitStore) g.__rateLimitStore = new Map();
  return g.__rateLimitStore;
}

export function getClientIp(request: { headers?: Headers }) {
  const xf = request?.headers?.get?.('x-forwarded-for') || '';
  if (xf) return xf.split(',')[0].trim();
  return (
    request?.headers?.get?.('x-real-ip') ||
    request?.headers?.get?.('cf-connecting-ip') ||
    request?.headers?.get?.('x-client-ip') ||
    'unknown'
  );
}

export function rateLimit(key: string, { limit, windowMs }: { limit: number; windowMs: number }) {
  const store = getStore();
  const now = Date.now();
  const rec = store.get(key) || { resetAt: now + windowMs, count: 0 };
  if (now > rec.resetAt) {
    rec.resetAt = now + windowMs;
    rec.count = 0;
  }
  rec.count += 1;
  store.set(key, rec);
  const remaining = Math.max(0, limit - rec.count);
  const retryAfterMs = Math.max(0, rec.resetAt - now);
  return { ok: rec.count <= limit, remaining, retryAfterMs };
}
