// Shared fixtures for test/integration/*.test.ts, backed by a real Postgres database
// (DATABASE_URL from .env.test — never the dev/prod database). Reuses scripts/seed.ts's
// demo data (tenant "Clínica Portucale" + admin/receptionist/dentist + 5 patients) instead
// of inventing new fixtures, and adds one extra tenant ("Tenant B (testes)") on top — the
// seed script doesn't create a second tenant, and cross-tenant isolation is exactly what
// this suite needs to exercise.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { closePool, queryOne } from '../../lib/db.ts';
import type { TestUser } from './authedRequest.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const TENANT_A_NAME = 'Clínica Portucale';
const TENANT_B_NAME = 'Tenant B (testes)';

// node --test runs each test file in its own process, so a lazy per-process flag can't
// stop two files from racing to `--reset` the DB on the very first run. An advisory lock
// serializes the check-and-maybe-seed section across processes; whoever loses the race
// re-checks after acquiring the lock and finds the winner already did the work.
const SEED_LOCK_KEY = 847_291_003;

let seededPromise: Promise<void> | null = null;

// Idempotent + safe to call from every test file's before() — only the first caller in
// *this* process actually does work, everyone else awaits the same promise.
export function ensureSeeded(): Promise<void> {
  if (!seededPromise) seededPromise = doEnsureSeeded();
  return seededPromise;
}

// Pool dedicado só para o arranque (abaixo). Não usa lib/db.ts de propósito:
// os helpers de lá envolvem CADA query numa transação (para o SET LOCAL do
// contexto RLS), e uma transação aberta é exatamente o que não pode existir
// aqui — ver o comentário em doEnsureSeeded.
let bootstrapPool: pg.Pool | null = null;
function getBootstrapPool() {
  if (!bootstrapPool) bootstrapPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return bootstrapPool;
}

async function doEnsureSeeded() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL not set. Run integration tests with:\n' +
        "  node --import tsx --env-file=.env.test --test 'test/integration/*.test.ts'",
    );
  }

  // ─── Porque é que isto NÃO corre dentro de uma transação ────────────────────
  // Corria, e bloqueava para sempre contra uma base de dados vazia: o processo
  // que ganhava o advisory lock fazia o `SELECT ... FROM tenants` dentro da
  // transação aberta (ficando com ACCESS SHARE sobre `tenants`) e só depois
  // lançava o seed.ts, cujo `DROP TABLE ... CASCADE` espera por ACCESS
  // EXCLUSIVE — ou seja, pela transação do próprio pai, que por sua vez está
  // parado à espera do filho. Auto-deadlock, e só numa base vazia: com a base
  // já semeada ninguém chegava a lançar o seed e o suite passava.
  //
  // Sem BEGIN, cada statement faz autocommit e larga os locks de tabela de
  // imediato. O advisory lock é de sessão, por isso continua seguro pelo mesmo
  // cliente enquanto o seed corre — que é precisamente o que serializa os
  // processos que `node --test` lança em paralelo.
  const client = await getBootstrapPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
    try {
      if (!(await tenantExists(client, TENANT_A_NAME))) {
        // Spawns scripts/seed.ts as its own process (own pg.Pool, same DATABASE_URL from
        // the inherited env) rather than importing it — the script does a `--reset` DROP
        // CASCADE, deliberately kept out-of-process from lib/db.ts's singleton pool.
        execFileSync(
          process.execPath,
          ['--import', 'tsx', join(ROOT, 'scripts', 'seed.ts'), '--reset', '--with-demo-users'],
          { cwd: ROOT, env: process.env, stdio: 'inherit' },
        );
        // seed.ts --reset only applies scripts/schema.sql — tables added later purely via
        // scripts/migrations/ (e.g. appointment_cancellations, from 004_schedule_intel.sql)
        // don't exist yet after that alone. A real deployment is schema.sql + migrate.ts
        // (see lib/db.ts's warnSchemaGap, which literally suggests `npm run db:migrate` on
        // a missing-relation error), so the test DB needs the same to be representative.
        execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'migrate.ts')], {
          cwd: ROOT,
          env: process.env,
          stdio: 'inherit',
        });
      }
      await ensureTenantB(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function tenantExists(client: import('pg').PoolClient, name: string) {
  try {
    const res = await client.query(`SELECT 1 FROM tenants WHERE name=$1 LIMIT 1`, [name]);
    return (res.rowCount ?? 0) > 0;
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return false; // schema not applied yet
    throw e;
  }
}

async function ensureTenantB(client: import('pg').PoolClient) {
  let tenantBId: string;
  const existing = await client.query(`SELECT id FROM tenants WHERE name=$1 LIMIT 1`, [TENANT_B_NAME]);
  if (existing.rowCount) {
    tenantBId = existing.rows[0].id;
  } else {
    const created = await client.query(
      `INSERT INTO tenants (name, city, operatories, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [TENANT_B_NAME, 'Porto', 2],
    );
    tenantBId = created.rows[0].id;
  }

  await client.query(
    `INSERT INTO users (email, password, name, role, clinic, tenant_id)
     VALUES ('admin.b@tenantb.test', 'x', 'Admin Tenant B', 'admin', $1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [TENANT_B_NAME, tenantBId],
  );

  const existingPatientB = await client.query(`SELECT id FROM patients WHERE tenant_id=$1 LIMIT 1`, [tenantBId]);
  if (!existingPatientB.rowCount) {
    await client.query(
      `INSERT INTO patients (tenant_id, name, status, country)
       VALUES ($1, 'Paciente Tenant B', 'registered', 'PT')`,
      [tenantBId],
    );
  }
}

export async function getTenantId(name: string): Promise<string> {
  const row = await queryOne(`SELECT id FROM tenants WHERE name=$1 LIMIT 1`, [name]);
  if (!row) throw new Error(`Tenant not found: ${name}. Did ensureSeeded() run?`);
  return row.id;
}

export const getTenantAId = () => getTenantId(TENANT_A_NAME);
export const getTenantBId = () => getTenantId(TENANT_B_NAME);

export async function getSeededUser(email: string): Promise<TestUser> {
  const row = await queryOne(`SELECT id, name, role, clinic, tenant_id FROM users WHERE email=$1 LIMIT 1`, [email]);
  if (!row) throw new Error(`Seeded user not found: ${email}. Did ensureSeeded() run?`);
  return { id: row.id, name: row.name, role: row.role, clinic: row.clinic, tenantId: row.tenant_id };
}

// O seed cria um super-admin (tenant_id NULL), uma rececionista e um dentista — nunca um
// admin de uma clínica concreta, que é o papel de que alguns testes precisam. Isto cria-o
// de verdade, em vez de assinar um JWT com um UUID inventado: desde que hasPermission()
// revalida a sessão contra a tabela `users` (ver lib/permissions.ts), um token para um
// utilizador que não existe é — corretamente — recusado com 403.
//
// Idempotente por email, para não deixar uma linha nova por cada execução da suite.
export async function getOrCreateTenantAdmin(tenantId: string, clinic: string): Promise<TestUser> {
  const email = 'admin.tenant-a@portucale.test';
  const row = await queryOne(
    `INSERT INTO users (email, password, name, role, clinic, tenant_id, active)
     VALUES ($1, 'x-nao-usado-nunca-ha-login-nestes-testes', 'Admin A (teste)', 'admin', $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET role='admin', clinic=EXCLUDED.clinic, tenant_id=EXCLUDED.tenant_id, active=TRUE
     RETURNING id, name, role, clinic, tenant_id`,
    [email, clinic, tenantId],
  );
  if (!row) throw new Error(`Não foi possível criar o admin de teste para o tenant ${tenantId}.`);
  return { id: row.id, name: row.name, role: row.role, clinic: row.clinic, tenantId: row.tenant_id };
}

export async function getSeededPatientId(tenantId: string): Promise<string> {
  const row = await queryOne(`SELECT id FROM patients WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [tenantId]);
  if (!row) throw new Error(`No seeded patient found for tenant ${tenantId}.`);
  return row.id;
}

export async function getSeededDentistId(tenantId: string): Promise<string> {
  const row = await queryOne(`SELECT id FROM users WHERE tenant_id=$1 AND role='dentist' LIMIT 1`, [tenantId]);
  if (!row) throw new Error(`No seeded dentist found for tenant ${tenantId}.`);
  return row.id;
}

// Call from a single `after()` per test file — closePool() is idempotent (no-op if already
// closed), so every file doing this is safe even though they share the same global pool.
export async function closeTestDb() {
  await closePool();
  if (bootstrapPool) {
    await bootstrapPool.end();
    bootstrapPool = null;
  }
}
