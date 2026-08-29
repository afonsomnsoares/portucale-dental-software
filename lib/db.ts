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
    const connectionString = process.env.DATABASE_URL;
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

const warnedGaps = new Set<string>();

// Logs (once per scope) when a query hits a missing table/column — surfaces schema drift
export function warnSchemaGap(scope: string, e: unknown) {
  const code = (e as { code?: string })?.code;
  if ((code === '42P01' || code === '42703') && !warnedGaps.has(scope)) {
    warnedGaps.add(scope);
    console.warn(`[schema] estrutura em falta em "${scope}" (code=${code}) — executar npm run db:migrate?`);
  }
}

// Helper — run a query and return rows
export async function query(sql: string, params: unknown[] = []) {
  const client = await getPool().connect();
  try {
    const res = await client.query(sql, params);
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL rows — column shape varies per query, callers know their own schema
    return res.rows as Record<string, any>[];
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
