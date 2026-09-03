// Verifica que o Row-Level Security BLOQUEIA mesmo, e não apenas que existe.
//
// test/integration/rls-coverage.test.ts confirma que cada tabela com `tenant_id` tem uma
// política chamada `tenant_isolation`. Isso apanha uma tabela nova que nasça sem política
// nenhuma — não apanha uma política com a cláusula USING errada, que é o modo de falha
// mais provável e o mais silencioso. E não podia apanhar: o resto da suite liga-se como
// `postgres`, que é SUPERUSER, e os superusers ignoram RLS incondicionalmente, FORCE
// incluído. O próprio lib/db.ts grita isso na consola a cada corrida.
//
// Por isso este ficheiro abre a SUA ligação, como o papel restrito `portucale_app` — o
// mesmo com que a app corre em produção (APP_DATABASE_URL) — e não usa lib/db.ts. Os
// restantes ficheiros continuam com a ligação admin, de que precisam para montar fixtures
// cross-tenant.
//
// Auto-provisiona-se: sem APP_DATABASE_URL definida, define a password de portucale_app
// pela ligação admin e constrói o DSN. Um teste de segurança que exige configuração manual
// é um teste de segurança que não corre.
//
// Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { closeTestDb, ensureSeeded, getTenantAId, getTenantBId } from '../helpers/testDb.ts';

const NO_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000';
const CANARY = `canario-rls-${Date.now()}`;

let adminPool: pg.Pool;
let appPool: pg.Pool;
let tenantAId: string;
let tenantBId: string;
/**
 * Tabelas com política tenant_isolation, lidas do catálogo do Postgres, e a coluna por
 * onde cada uma discrimina a clínica. É `tenant_id` em todas menos numa: `tenants` é a
 * própria lista de clínicas e isola pelo seu `id`.
 */
let guardedTables: Array<{ table: string; column: string }> = [];

// Constrói o DSN do papel restrito a partir do admin, trocando só as credenciais.
async function appConnectionString(): Promise<string> {
  const fromEnv = process.env.APP_DATABASE_URL;
  if (fromEnv) return fromEnv;

  const admin = process.env.DATABASE_URL;
  if (!admin) throw new Error('DATABASE_URL not set — corre com --env-file=.env.test');

  // Hex puro: entra num literal SQL de ALTER ROLE (que não aceita parâmetros) sem
  // qualquer superfície de escape.
  const password = crypto.randomBytes(24).toString('hex');
  await adminPool.query(`ALTER ROLE portucale_app PASSWORD '${password}'`);

  const url = new URL(admin);
  url.username = 'portucale_app';
  url.password = password;
  return url.toString();
}

/**
 * Corre `fn` sob o contexto de tenant que lib/db.ts estabelece por pedido — os mesmos dois
 * GUCs, com a mesma semântica de SET LOCAL, e por isso dentro de uma transação explícita.
 * Passar `tenantId` a null reproduz "nenhum contexto estabelecido", que tem de ser
 * fail-closed.
 */
async function asTenant<T>(
  tenantId: string | null,
  isSuperAdmin: boolean,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.is_super_admin', $2, true)`, [
      tenantId || NO_TENANT_SENTINEL,
      isSuperAdmin ? 'true' : 'false',
    ]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();

  adminPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  appPool = new pg.Pool({ connectionString: await appConnectionString(), max: 4 });

  const { rows } = await adminPool.query(
    `SELECT c.relname AS table_name,
            CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='tenant_id'
            ) THEN 'tenant_id' ELSE 'id' END AS tenant_column
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE p.polname = 'tenant_isolation'
      ORDER BY 1`,
  );
  guardedTables = rows.map((r: { table_name: string; tenant_column: string }) => ({
    table: r.table_name,
    column: r.tenant_column,
  }));

  // Canário na clínica B: sem isto, uma varredura sobre tabelas vazias passava por estar
  // tudo bem quando na verdade não havia nada para esconder.
  await adminPool.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1,$2)`, [tenantBId, CANARY]);
});

after(async () => {
  await adminPool.query(`DELETE FROM suppliers WHERE name=$1`, [CANARY]).catch(() => {});
  await appPool.end().catch(() => {});
  await adminPool.end().catch(() => {});
  await closeTestDb();
});

describe('pré-condições — sem isto o resto do ficheiro não prova nada', () => {
  test('a ligação de teste NÃO é superuser', async () => {
    const { rows } = await appPool.query(
      `SELECT current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser`,
    );
    assert.equal(rows[0].is_superuser, false, `ligado como "${rows[0].role}", que ignora RLS — o teste seria vazio`);
  });

  test('há tabelas com política tenant_isolation para verificar', async () => {
    assert.ok(guardedTables.length > 40, `só ${guardedTables.length} tabelas com tenant_isolation — schema por migrar?`);
  });

  test('o canário existe mesmo, visto pela ligação admin', async () => {
    const { rows } = await adminPool.query(`SELECT tenant_id FROM suppliers WHERE name=$1`, [CANARY]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenant_id, tenantBId);
  });
});

describe('leitura', () => {
  test('nenhuma tabela deixa passar uma linha de outra clínica', async () => {
    const leaks: string[] = [];
    const nonVacuous: string[] = [];

    // Linhas com a coluna a NULL são o catálogo global (treatment_codes, statuses,
    // schema_fields) ou registos de plataforma (job_runs, agent_insights) — não são dados
    // de outra clínica, e três das políticas deixam-nas passar de propósito.
    const foreignRows = (table: string, column: string) =>
      `SELECT count(*)::int AS n FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> $1::uuid`;

    // Os identificadores vêm do catálogo do Postgres, não de input — mas passam por
    // quote_ident à mesma, para não deixar aqui um padrão que alguém copie para onde não vem.
    const quoted = await Promise.all(
      guardedTables.map(async ({ table, column }) => {
        const { rows } = await adminPool.query(`SELECT quote_ident($1) AS t, quote_ident($2) AS c`, [table, column]);
        return { table, ident: rows[0].t as string, column: rows[0].c as string };
      }),
    );

    await asTenant(tenantAId, false, async (client) => {
      for (const { table, ident, column } of quoted) {
        const { rows } = await client.query(foreignRows(ident, column), [tenantAId]);
        if (rows[0].n > 0) leaks.push(`${table} (${rows[0].n})`);
      }
    });

    // Quantas destas tabelas TÊM mesmo dados de outra clínica para esconder — medido pela
    // ligação admin, que os vê todos. Sem isto a varredura acima podia passar por vazia.
    for (const { table, ident, column } of quoted) {
      const { rows } = await adminPool.query(foreignRows(ident, column), [tenantAId]);
      if (rows[0].n > 0) nonVacuous.push(table);
    }

    assert.deepEqual(leaks, [], `RLS não bloqueou: ${leaks.join(', ')}`);
    assert.ok(
      nonVacuous.length > 0,
      'nenhuma tabela tinha dados de outra clínica — a varredura passou por vazia, não por correta',
    );
  });

  test('o canário da clínica B é invisível para a clínica A', async () => {
    const rows = await asTenant(tenantAId, false, async (client) => {
      // Sem filtro nenhum: é a app a "esquecer-se" do WHERE tenant_id, que é exatamente o
      // erro contra o qual esta camada existe.
      const r = await client.query(`SELECT name FROM suppliers`);
      return r.rows as Array<{ name: string }>;
    });
    assert.ok(!rows.some((r) => r.name === CANARY), 'a clínica A viu um fornecedor da clínica B');
  });

  test('pedir explicitamente a clínica B não serve de nada', async () => {
    const n = await asTenant(tenantAId, false, async (client) => {
      const r = await client.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id=$1::uuid`, [tenantBId]);
      return r.rows[0].n as number;
    });
    assert.equal(n, 0, 'SQL a apontar deliberadamente para outra clínica devia devolver zero linhas');
  });

  test('sem contexto de sessão, não se vê nada — fail-closed', async () => {
    const n = await asTenant(null, false, async (client) => {
      const r = await client.query(`SELECT count(*)::int AS n FROM patients`);
      return r.rows[0].n as number;
    });
    assert.equal(n, 0, 'um pedido sem contexto de tenant devia ver zero linhas, não todas');
  });

  test('o super-admin atravessa as clínicas, como a aplicação assume', async () => {
    const n = await asTenant(null, true, async (client) => {
      const r = await client.query(`SELECT count(*)::int AS n FROM suppliers WHERE name=$1`, [CANARY]);
      return r.rows[0].n as number;
    });
    assert.equal(n, 1, 'is_super_admin=true devia ver todas as clínicas');
  });
});

describe('escrita — a política também tem WITH CHECK', () => {
  test('não se cria uma linha em nome de outra clínica', async () => {
    await assert.rejects(
      () =>
        asTenant(tenantAId, false, (client) =>
          client.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1,$2)`, [tenantBId, `${CANARY}-insert`]),
        ),
      /row-level security/i,
      'inserir com o tenant_id de outra clínica devia ser recusado pela base de dados',
    );
  });

  test('não se transfere uma linha nossa para outra clínica', async () => {
    // asTenant faz sempre ROLLBACK, por isso a linha criada aqui só existe dentro desta
    // transação e não fica para trás — nem sequer quando o UPDATE é recusado.
    await assert.rejects(
      () =>
        asTenant(tenantAId, false, async (client) => {
          await client.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1,$2)`, [
            tenantAId,
            `${CANARY}-update`,
          ]);
          return client.query(`UPDATE suppliers SET tenant_id=$1 WHERE name=$2`, [tenantBId, `${CANARY}-update`]);
        }),
      /row-level security/i,
      'mover uma linha para outra clínica devia ser recusado',
    );
  });

  test('o audit_log é append-only para o papel da aplicação', async () => {
    // REVOKE UPDATE, DELETE (migração 011 / schema.sql) — a cadeia de hash da migração 015
    // deteta adulteração, isto impede-a de sequer ser tentada por esta ligação.
    await assert.rejects(
      () => asTenant(tenantAId, false, (client) => client.query(`DELETE FROM audit_log WHERE TRUE`)),
      /permission denied/i,
      'a ligação da aplicação não devia poder apagar o trilho de auditoria',
    );
    await assert.rejects(
      () => asTenant(tenantAId, false, (client) => client.query(`UPDATE audit_log SET action='x'`)),
      /permission denied/i,
      'a ligação da aplicação não devia poder alterar o trilho de auditoria',
    );
  });
});
