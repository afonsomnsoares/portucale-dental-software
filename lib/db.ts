import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: import('pg').Pool | undefined;
}

// Lazy singleton pool — created on first query, reused across hot reloads in dev.
// Keeps module import side-effect-free (unit tests import lib/* without a database).
function getPool(): import('pg').Pool {
  const g = globalThis;
  if (!g.__pgPool) {
    // APP_DATABASE_URL, when set, points at the restricted `portucale_app` role
    // subject to the Row-Level Security policies in
    // scripts/migrations/011_row_level_security.sql — see that file's header
    // comment. Falls back to DATABASE_URL (the admin/owner connection) when
    // unset, which is today's behavior and what scripts/migrate.ts,
    // scripts/seed.ts and scripts/run-jobs.ts (see the guard at the top of
    // that file) all keep using, since they legitimately need cross-tenant or
    // DDL access that RLS would otherwise block.
    const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    g.__pgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    g.__pgPool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
  }
  return g.__pgPool;
}

// ─── Row-Level Security session context ──────────────────────────────────────
// Every query() / queryOne() call sets two Postgres GUCs (app.tenant_id,
// app.is_super_admin) from this AsyncLocalStorage store before running the
// caller's SQL, so the RLS policies in scripts/migrations/011_row_level_security.sql
// see the *authenticated* tenant regardless of what the SQL itself asks for —
// a defense-in-depth backstop for the app-level tenant checks scattered across
// app/api/*. lib/auth.ts's getAuth() calls enterTenantContext() as its very
// last step, so every route that already calls getAuth() first (all of them
// except the two pre-auth exceptions below) gets this for free.
interface TenantContext {
  tenantId: string | null;
  isSuperAdmin: boolean;
}

// Matches no real tenant row — the fail-closed default when no request ever
// established a context (a bug, or one of the two legitimate pre-auth
// exceptions that don't call enterTenantContext at all: login and bootstrap,
// see withSystemContext below).
const NO_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000';

const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

// Called once per authenticated request (from getAuth()) — mutates the store
// for the rest of the current async execution, no wrapping callback needed.
export function enterTenantContext(user: { tenantId?: string | null; role?: string } | null | undefined) {
  tenantContextStorage.enterWith({
    tenantId: user?.tenantId ?? null,
    isSuperAdmin: user?.role === 'super_admin',
  });
}

// Explicit escape hatch for the two routes that must query `users` *before* a
// session exists (login, bootstrap) — searching across every tenant by email
// is inherent to that step, not a bug. Nothing else should need this.
export function withSystemContext<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: null, isSuperAdmin: true }, fn);
}

async function applyTenantContext(client: import('pg').PoolClient) {
  const ctx = tenantContextStorage.getStore();
  await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.is_super_admin', $2, true)`, [
    ctx?.tenantId || NO_TENANT_SENTINEL,
    ctx?.isSuperAdmin ? 'true' : 'false',
  ]);
}

const warnedGaps = new Set<string>();

// Logs (once per scope) when a query hits a missing table/column — surfaces schema drift
export function warnSchemaGap(scope: string, e: unknown) {
  const code = (e as { code?: string })?.code;
  if ((code === '42P01' || code === '42703') && !warnedGaps.has(scope)) {
    warnedGaps.add(scope);
    console.warn(`[schema] estrutura em falta em "${scope}" (code=${code}) — executar npm run db:migrate?`);
  }
}

// Helper — run a query and return rows. Wrapped in its own transaction so
// applyTenantContext's `set_config(..., true)` (SET LOCAL semantics) is
// actually in effect for the statement that follows it — without an explicit
// transaction, each is its own implicit one and the setting wouldn't carry
// over. See the RLS session context section above.
export async function query(sql: string, params: unknown[] = []) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyTenantContext(client);
    const res = await client.query(sql, params);
    await client.query('COMMIT');
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL rows — column shape varies per query, callers know their own schema
    return res.rows as Record<string, any>[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Helper — return first row only
export async function queryOne(sql: string, params: unknown[] = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Closes the singleton pool and clears the global reference. Not used by the app itself
// (the pool is meant to outlive requests) — exists so test suites (node:test) can end the
// process cleanly instead of hanging on an open connection.
export async function closePool() {
  const g = globalThis;
  if (g.__pgPool) {
    await g.__pgPool.end();
    g.__pgPool = undefined;
  }
}

// Helper — run inside a transaction
export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyTenantContext(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
