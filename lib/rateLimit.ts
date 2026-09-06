interface RateRecord {
  resetAt: number;
  count: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, RateRecord> | undefined;
  // eslint-disable-next-line no-var
  var __rateLimitNextSweep: number | undefined;
}

// ─── LIMITE CONHECIDO: o estado é por instância ──────────────────────────────
// A contagem vive em `globalThis`, ou seja, na memória de UM processo. Com o
// deploy de contentor único do docker-compose.yml isto está correto e é o que
// se quer: sem dependências, sem latência de rede no caminho de cada pedido.
//
// A partir de duas instâncias atrás de um balanceador deixa de estar:
//   • o limite efetivo passa a ser N × o configurado, porque cada instância
//     conta em separado;
//   • o travão do login (app/api/auth/login/route.ts) deixa de ser um travão —
//     quem tentar adivinhar passwords só tem de calhar noutra instância, e um
//     balanceador round-robin garante-lhe isso de graça.
//
// Não é ignorância do problema, é a escolha certa para a topologia atual.
// O middleware corre no Edge runtime, onde não há acesso a Postgres —
// por isso o rate limit aqui é em memória. Para route handlers que rodam
// no Node runtime (e podem usar Postgres), existe lib/rateLimitGlobal.ts
// com contador partilhado na tabela rate_limit_counters. Antes de escalar
// horizontalmente, o middleware também precisa de uma solução Edge-friendly
// (Upstash/Redis) ou de ser movido para Node.
// Manter esta nota junto ao código que a causa.

// ─── Why this store needs sweeping ──────────────────────────────────────────
// Keys are per-identity: `api:user:<id>` for signed-in callers, but `api:ip:<addr>`
// for anonymous ones (see middleware.ts), plus per-token keys on the public routes.
// The anonymous keys are the problem — their key space is chosen by whoever is
// calling, so without eviction every distinct source address that ever touches the
// API leaves a permanent entry. A window expiring reset the *count* but never
// removed the record, so the Map only ever grew: a slow leak in normal use, and a
// trivially cheap memory-exhaustion vector for anyone willing to rotate addresses.
//
// Swept lazily on call rather than on a timer: middleware.ts runs in the Edge
// runtime, where a long-lived setInterval is not something to rely on, and where
// there is no shutdown hook to clear one either.
const SWEEP_INTERVAL_MS = 60 * 1000;
// Backstop for the case the sweep cannot keep up — an attacker rotating addresses
// faster than their windows expire. Well past what legitimate traffic produces
// (one entry per active user or address per window), so reaching it means something
// is wrong, and shedding the entries closest to expiry is the least-harm response.
const MAX_TRACKED_KEYS = 20_000;

function getStore() {
  const g = globalThis;
  if (!g.__rateLimitStore) g.__rateLimitStore = new Map();
  return g.__rateLimitStore;
}

// Drops every window that has already elapsed. An entry past resetAt is
// indistinguishable from one that never existed — rateLimit() below resets count to
// 0 on encountering one — so removing it changes no behaviour, only footprint.
function sweep(store: Map<string, RateRecord>, now: number) {
  for (const [key, rec] of store) {
    if (now > rec.resetAt) store.delete(key);
  }

  if (store.size <= MAX_TRACKED_KEYS) return;
  // Still oversized after dropping the expired ones: evict live windows, soonest to
  // expire first. Those are the entries closest to being forgotten anyway, and an
  // evicted attacker gets a fresh budget — which is the same thing they would get by
  // waiting, so the cap costs accuracy under attack rather than correctness.
  const byExpiry = Array.from(store.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < byExpiry.length - MAX_TRACKED_KEYS; i += 1) {
    store.delete(byExpiry[i][0]);
  }
}

function maybeSweep(store: Map<string, RateRecord>, now: number) {
  const g = globalThis;
  const due = g.__rateLimitNextSweep ?? 0;
  // The size check forces a sweep the moment the cap is breached, without waiting for
  // the interval — which is exactly the burst case the cap exists for.
  if (now < due && store.size <= MAX_TRACKED_KEYS) return;
  g.__rateLimitNextSweep = now + SWEEP_INTERVAL_MS;
  sweep(store, now);
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
  maybeSweep(store, now);

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

// Test-only helpers — the store lives on globalThis so it survives hot reloads, which
// also means it survives between tests in a single process.
export function __rateLimitStoreSize() {
  return getStore().size;
}

export function __resetRateLimitStore() {
  globalThis.__rateLimitStore = new Map();
  globalThis.__rateLimitNextSweep = 0;
}
