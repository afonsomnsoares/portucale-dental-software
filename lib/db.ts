import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: import('pg').Pool | undefined;
}

// Processes that legitimately need the admin/owner connection (cross-tenant reads,
// DDL) opt out of the production guard below by setting this to '1' — today only
// scripts/run-jobs.ts, which already deletes APP_DATABASE_URL for the same reason.
// It is deliberately an explicit opt-in marker rather than something inferred from
// the environment: "is this the web server or a maintenance script" is not a
// question the runtime can answer reliably, and guessing wrong in the permissive
// direction is exactly the failure this guard exists to prevent.
const ADMIN_CONNECTION_OPT_OUT = process.env.PORTUCALE_ADMIN_CONNECTION === '1';

// One-time check that the role we actually connected as cannot bypass the RLS
// policies. Superusers ignore row-level security unconditionally — FORCE included —
// so a deployment that sets APP_DATABASE_URL to a superuser DSN gets every policy in
// scripts/migrations/011_row_level_security.sql silently disabled, with no error and
// no behavioural difference until a tenant sees another tenant's rows. Checking the
// env var is set is not enough; this checks what the database says about us.
//
// Deliberately a loud log rather than a throw: it runs after the pool already exists
// and killing every in-flight request on a misconfiguration we can still serve
// correctly (the app-level tenant filters are all still in place) would turn a
// hardening gap into an outage.
async function assertRoleCannotBypassRls(pool: import('pg').Pool) {
  if (ADMIN_CONNECTION_OPT_OUT) return;
  try {
    const { rows } = await pool.query(
      `SELECT current_user AS role,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
              pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS can_create`,
    );
    const row = rows[0];
    if (row?.is_superuser) {
      console.error(
        `[db] SEGURANÇA: ligado como "${row.role}", que é SUPERUSER — o Row-Level Security ` +
          `NÃO está a ser aplicado (superusers ignoram RLS, FORCE incluído). ` +
          `Define APP_DATABASE_URL a apontar para o papel portucale_app ` +
          `(ver scripts/migrations/011_row_level_security.sql).`,
      );
    } else if (row?.can_create) {
      console.warn(
        `[db] AVISO: o papel "${row.role}" tem privilégio CREATE nesta base de dados — ` +
          `provavelmente é o dono do schema, e o dono só respeita as políticas graças ao ` +
          `FORCE ROW LEVEL SECURITY. Preferir APP_DATABASE_URL com portucale_app.`,
      );
    }
  } catch (e) {
    console.warn('[db] não foi possível verificar o papel da ligação:', e instanceof Error ? e.message : e);
  }
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
    // unset, which is what scripts/migrate.ts, scripts/seed.ts and
    // scripts/run-jobs.ts (see the guard at the top of that file) all keep
    // using, since they legitimately need cross-tenant or DDL access that RLS
    // would otherwise block.
    //
    // In production that fallback is refused outright: it is silent — the app
    // starts, serves traffic and behaves identically, with every RLS policy
    // inert — so the failure mode is a tenant-isolation breach that surfaces
    // only when someone notices another clinic's data. A process that really
    // needs the admin connection says so with PORTUCALE_ADMIN_CONNECTION=1.
    if (process.env.NODE_ENV === 'production' && !process.env.APP_DATABASE_URL && !ADMIN_CONNECTION_OPT_OUT) {
      throw new Error(
        'APP_DATABASE_URL is required in production — it is the RLS-restricted connection ' +
          '(role portucale_app, see scripts/migrations/011_row_level_security.sql). Falling back ' +
          'to DATABASE_URL would run the app as the schema owner and disable tenant isolation ' +
          'at the database level. Set PORTUCALE_ADMIN_CONNECTION=1 only for maintenance ' +
          'processes that genuinely need cross-tenant access.',
      );
    }

    const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
    g.__pgPool = pool;
    void assertRoleCannotBypassRls(pool);
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

// Explicit escape hatch for the steps that must query `users` *before* — or
// independently of — the tenant the caller claims to be in. Three today, all of
// the same shape: login and bootstrap (no session exists yet), and
// lib/permissions.ts's session revalidation (a session exists, but the tenant it
// asserts is exactly what is being checked; `users` is under FORCE row security,
// so reading it under a stale tenant would return no row and deny a legitimate
// user who simply changed clinic). Nothing else should need this.
export function withSystemContext<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: null, isSuperAdmin: true }, fn);
}

// A identidade do pedido em curso, para quem precise de memorizar trabalho pelo
// tempo de vida de um pedido e não mais do que isso. Devolve o próprio objeto do
// AsyncLocalStorage — serve de chave de WeakMap (ver lib/permissions.ts), que é
// libertada sozinha quando o pedido acaba. Undefined fora de um pedido
// autenticado (jobs, scripts, testes de unidade), e aí quem chama não memoiza.
export function currentRequestKey(): object | undefined {
  return tenantContextStorage.getStore();
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
