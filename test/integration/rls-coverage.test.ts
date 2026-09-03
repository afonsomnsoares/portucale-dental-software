// Guarda contra deriva de Row-Level Security. Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// A view `tenant_tables_without_rls` (scripts/schema.sql e migração 033) lista
// tabelas com coluna `tenant_id` sem política `tenant_isolation`. Existia desde
// a migração 033 mas nada a consultava, por isso uma tabela nova podia nascer
// sem RLS e ninguém dava por isso até alguém correr a query à mão. Este teste
// faz disso uma falha de build.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { closeTestDb } from '../helpers/testDb.ts';

after(closeTestDb);

test('todas as tabelas com tenant_id têm política tenant_isolation', async () => {
  const rows = await query('SELECT table_name FROM tenant_tables_without_rls');
  const missing = rows.map((r) => r.table_name);
  assert.deepEqual(
    missing,
    [],
    `Tabelas com tenant_id sem política tenant_isolation: ${missing.join(', ')}.\n` +
      'Adiciona-as ao bloco RLS da migração que as cria (ver 026/027 como exemplo).',
  );
});

test('a view de cobertura existe — instalação de raiz e migrada não divergem', async () => {
  const rows = await query(
    `SELECT 1 AS ok FROM pg_views WHERE schemaname='public' AND viewname='tenant_tables_without_rls'`,
  );
  assert.equal(rows.length, 1, 'tenant_tables_without_rls em falta — schema.sql desatualizado face às migrações');
});
