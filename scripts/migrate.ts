// scripts/migrate.ts — run with: node --import tsx scripts/migrate.ts
// @ts-nocheck

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/portucale_dental',
});

interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number; rows: Record<string, unknown>[] }>;
  release(): void;
}

async function ensureMigrationsTable(client: PgClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles() {
  try {
    const files = await readdir(MIGRATIONS_DIR);
    return files.filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function hasMigration(client: PgClient, id: string) {
  const r = await client.query(`SELECT 1 FROM schema_migrations WHERE id=$1 LIMIT 1`, [id]);
  return r.rowCount > 0;
}

async function tableExists(client: PgClient, name: string) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name],
  );
  return r.rowCount > 0;
}

async function columnExists(client: PgClient, table: string, column: string) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rowCount > 0;
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureMigrationsTable(client);
    const files = await listMigrationFiles();
    for (const f of files) {
      const id = f;
      if (await hasMigration(client, id)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      if (String(sql || '').trim()) {
        await client.query(sql);
      }
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
      console.log(`✅ Applied migration ${id}`);
    }

    if (await tableExists(client, 'tenants')) {
      if (!(await columnExists(client, 'tenants', 'operatories'))) {
        await client.query(`ALTER TABLE tenants ADD COLUMN operatories INTEGER NOT NULL DEFAULT 3`);
      }
    }

    if (await tableExists(client, 'appointments')) {
      if (!(await columnExists(client, 'appointments', 'dentist_id'))) {
        await client.query(`ALTER TABLE appointments ADD COLUMN dentist_id UUID REFERENCES users(id)`);
      }
    }

    if (await tableExists(client, 'patients')) {
      if (!(await columnExists(client, 'patients', 'custom_fields'))) {
        await client.query(`ALTER TABLE patients ADD COLUMN custom_fields JSONB DEFAULT '{}'::jsonb`);
      }
    }

    if (await tableExists(client, 'schema_fields')) {
      if (!(await columnExists(client, 'schema_fields', 'label'))) {
        await client.query(`ALTER TABLE schema_fields ADD COLUMN label TEXT`);
      }
      if (!(await columnExists(client, 'schema_fields', 'description'))) {
        await client.query(`ALTER TABLE schema_fields ADD COLUMN description TEXT`);
      }
      if (!(await columnExists(client, 'schema_fields', 'enum_values'))) {
        await client.query(`ALTER TABLE schema_fields ADD COLUMN enum_values JSONB`);
      }
      if (!(await columnExists(client, 'schema_fields', 'tenant_id'))) {
        await client.query(
          `ALTER TABLE schema_fields ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
        );
      }

      await client.query(`ALTER TABLE schema_fields DROP CONSTRAINT IF EXISTS schema_fields_field_name_key`);
      await client.query(`DROP INDEX IF EXISTS schema_fields_field_name_key`);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_fields_tenant_field
          ON schema_fields(tenant_id, field_name)
          WHERE tenant_id IS NOT NULL
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_fields_global_field
          ON schema_fields(field_name)
          WHERE tenant_id IS NULL
      `);

      try {
        if (await tableExists(client, 'tenants')) {
          const t = await client.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 2`);
          if (t.rows.length === 1) {
            await client.query(
              `UPDATE schema_fields SET tenant_id=$1
               WHERE tenant_id IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM schema_fields sf
                   WHERE sf.tenant_id = $1 AND sf.field_name = schema_fields.field_name
                 )`,
              [t.rows[0].id],
            );
          }
        }
      } catch {}
    }

    const hasLegacyInventory = await tableExists(client, 'inventory');
    const hasNewInventoryItems = await tableExists(client, 'inventory_items');
    const hasNewInventoryStock = await tableExists(client, 'inventory_stock');

    if (hasLegacyInventory && (!hasNewInventoryItems || !hasNewInventoryStock)) {
      const legacyAlready = await tableExists(client, 'inventory_legacy');
      if (!legacyAlready) {
        await client.query(`ALTER TABLE inventory RENAME TO inventory_legacy`);
      }
    }

    if (!(await tableExists(client, 'inventory_items'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS inventory_items (
          id          SERIAL PRIMARY KEY,
          item        TEXT NOT NULL,
          unit        TEXT DEFAULT 'unit',
          reorder_at  INTEGER DEFAULT 10,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    }

    if (!(await tableExists(client, 'inventory_stock'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS inventory_stock (
          item_id     INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE,
          tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
          quantity    INTEGER NOT NULL DEFAULT 0,
          updated_at  TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (item_id, tenant_id)
        )
      `);
    }

    if (!(await tableExists(client, 'role_permissions'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS role_permissions (
          id         BIGSERIAL PRIMARY KEY,
          tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
          role       TEXT NOT NULL,
          action     TEXT NOT NULL,
          allowed    BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (tenant_id, role, action)
        )
      `);
    }

    if (!(await tableExists(client, 'notifications'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
          patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
          appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
          channel       TEXT NOT NULL,
          to_addr       TEXT,
          payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
          status        TEXT NOT NULL DEFAULT 'queued',
          provider_id   TEXT,
          attempts      INTEGER NOT NULL DEFAULT 0,
          next_retry_at TIMESTAMPTZ,
          last_error    TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          sent_at       TIMESTAMPTZ
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(status, next_retry_at)`);
    }

    if (!(await tableExists(client, 'job_runs'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_runs (
          id          BIGSERIAL PRIMARY KEY,
          job_name    TEXT NOT NULL,
          status      TEXT NOT NULL,
          started_at  TIMESTAMPTZ DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          details     JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
    }

    if (!(await tableExists(client, 'uploads'))) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS uploads (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
          patient_id   UUID REFERENCES patients(id) ON DELETE SET NULL,
          storage      TEXT NOT NULL DEFAULT 'local',
          storage_key  TEXT NOT NULL,
          url          TEXT NOT NULL,
          content_type TEXT,
          size         INTEGER,
          expires_at   TIMESTAMPTZ,
          created_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Migration complete');
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
