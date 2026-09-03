// Guarda de cobertura para os direitos do titular (RGPD art. 15.º a 20.º).
//
// PATIENT_TABLE_RULES em lib/dataSubject.ts decide, tabela a tabela, o que entra
// numa exportação e o que acontece num apagamento. Uma tabela nova ligada a um
// paciente que não apareça nessa lista sai silenciosamente da exportação e
// sobrevive intacta a um apagamento — precisamente a falha que ninguém deteta
// até um titular exercer o direito e a resposta vir incompleta.
//
// É o mesmo padrão de rls-coverage.test.ts: comparar a lista escrita à mão com o
// que o Postgres realmente tem.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PATIENT_TABLE_RULES, ruleFor } from '../../lib/dataSubject.ts';
import { query } from '../../lib/db.ts';
import { closeTestDb, ensureSeeded } from '../helpers/testDb.ts';

before(ensureSeeded);
after(closeTestDb);

async function tablesWithPatientId(): Promise<string[]> {
  const rows = await query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'patient_id'
                       AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname`);
  return rows.map((r) => String(r.table_name));
}

test('toda a tabela com patient_id tem uma disposição decidida', async () => {
  const semRegra = (await tablesWithPatientId()).filter((t) => !ruleFor(t));
  assert.deepEqual(
    semRegra,
    [],
    `Tabelas ligadas a um paciente sem disposição em PATIENT_TABLE_RULES:\n  ${semRegra.join('\n  ')}\n\n` +
      'Decide em lib/dataSubject.ts o que lhes acontece num pedido de acesso e de\n' +
      'apagamento: export | anonymize | delete | exclude, com a justificação.',
  );
});

test('nenhuma regra aponta para uma tabela que já não existe', async () => {
  const reais = new Set(await tablesWithPatientId());
  const fantasmas = PATIENT_TABLE_RULES.map((r) => r.table).filter((t) => !reais.has(t));
  assert.deepEqual(fantasmas, [], `Regras para tabelas inexistentes: ${fantasmas.join(', ')}`);
});

test('tenantScoped em cada regra corresponde ao que a tabela realmente tem', async () => {
  const rows = await query(`
    SELECT c.relname AS table_name,
           EXISTS (
             SELECT 1 FROM pg_attribute t
             WHERE t.attrelid = c.oid AND t.attname = 'tenant_id' AND t.attnum > 0 AND NOT t.attisdropped
           ) AS has_tenant_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'patient_id'
                       AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'`);

  const errados = rows
    .filter((r) => {
      const regra = ruleFor(String(r.table_name));
      return regra && regra.tenantScoped !== Boolean(r.has_tenant_id);
    })
    .map((r) => `${r.table_name} (real: ${r.has_tenant_id ? 'tem' : 'não tem'} tenant_id)`);

  assert.deepEqual(
    errados,
    [],
    `Regras cujo tenantScoped não corresponde à tabela:\n  ${errados.join('\n  ')}\n\n` +
      'Filtrar por uma coluna que não existe rebenta com 42703 em runtime; não filtrar\n' +
      'quando a coluna existe atravessa clínicas. Corrigir em lib/dataSubject.ts.',
  );
});

test('toda a regra traz uma justificação — a decisão tem de ser defensável', () => {
  const semPorque = PATIENT_TABLE_RULES.filter((r) => !r.why || r.why.length < 10).map((r) => r.table);
  assert.deepEqual(semPorque, [], `Regras sem justificação: ${semPorque.join(', ')}`);
});
