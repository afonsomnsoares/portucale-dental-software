// Guarda contra a deriva entre scripts/schema.sql e scripts/migrations/. Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// ─── O que correu mal, e porque é que ninguém deu por isso ──────────────────
// Oito tabelas são criadas nos dois sítios — no schema.sql e outra vez numa migração —
// sempre com `CREATE TABLE IF NOT EXISTS`. Como `scripts/migrate.ts` aplica o
// schema.sql primeiro numa base vazia, numa instalação de raiz é ele que ganha e a
// migração passa a não-operação... mas fica registada em `schema_migrations` como
// aplicada à mesma. Numa base anterior a essas tabelas terem entrado no schema.sql,
// ganhou a migração.
//
// As duas bases dizem-se igualmente «migradas» e têm colunas com nomes diferentes:
// `lab_orders.ordered_at` contra `created_at`, `medical_history.allergies` JSONB
// contra TEXT. O código está escrito contra a forma de raiz, por isso a clínica com a
// base antiga apanhava 42703 na página de Laboratório e 22P02 ao gravar a anamnese —
// e nenhum teste podia vê-lo, porque todos correm contra uma base de raiz.
//
// A migração 057 reconcilia as bases antigas. Este teste existe para que a deriva não
// volte: afirma que as colunas de que o código depende existem mesmo, tabela a tabela.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { closeTestDb } from '../helpers/testDb.ts';

after(closeTestDb);

// Cada entrada é uma coluna que uma query em app/ ou lib/ nomeia à letra. Se alguma
// desaparecer — ou nunca tiver existido nesta base — a rota que a usa devolve 500.
const REQUIRED: Record<string, string[]> = {
  // app/api/lab-orders/route.ts:29 (ORDER BY l.created_at), :51 (INSERT ... created_by)
  lab_orders: ['created_at', 'created_by', 'tenant_id', 'patient_id', 'lab_name', 'status'],
  // app/api/prescriptions/route.ts:26 (p.created_at), :49 (created_by)
  prescriptions: ['created_at', 'created_by', 'tenant_id', 'patient_id', 'medication', 'status'],
  // app/api/patients/[id]/medical-history/route.ts — INSERT nomeia todas estas
  medical_history: [
    'tenant_id',
    'patient_id',
    'allergies',
    'medications',
    'conditions',
    'family_history',
    'smoking',
    'pregnancy',
    'notes',
    'updated_by',
    'created_at',
  ],
  // app/api/consent-forms/route.ts:57
  consent_forms: ['tenant_id', 'patient_id', 'procedure_name', 'signed_by', 'signature_url', 'created_by', 'created_at'],
  // app/api/audit/route.ts — o isolamento passou a depender desta coluna (migração 056)
  audit_log: ['tenant_id', 'clinic', 'action', 'resource', 'created_at'],
  treatment_plans: ['tenant_id', 'patient_id', 'status', 'created_at'],
  ai_calls: ['tenant_id', 'agent', 'model', 'status'],
  leads: ['tenant_id', 'name', 'status', 'created_at'],
  rate_limit_counters: ['key', 'window_start', 'count'],
};

test('todas as colunas que o código nomeia existem mesmo nesta base', async () => {
  const rows = (await query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  )) as { table_name: string; column_name: string }[];

  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!have.has(r.table_name)) have.set(r.table_name, new Set());
    have.get(r.table_name)?.add(r.column_name);
  }

  const missing: string[] = [];
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const present = have.get(table);
    if (!present) {
      missing.push(`${table} (tabela inteira em falta)`);
      continue;
    }
    for (const col of cols) {
      if (!present.has(col)) missing.push(`${table}.${col}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Colunas em falta: ${missing.join(', ')}.\n` +
      'Sinal de deriva entre scripts/schema.sql e scripts/migrations/ — ver a migração 057.',
  );
});

test('os tipos que já mordiam estão certos: texto é texto, e não JSONB', async () => {
  // `allergies` era JSONB numa base antiga, e a rota escreve `allergies || ''`.
  // String vazia não é JSON válido: 22P02 em toda e qualquer gravação de anamnese.
  const rows = (await query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='medical_history'
        AND column_name IN ('allergies','medications','conditions','family_history','smoking','pregnancy','notes')`,
  )) as { column_name: string; data_type: string }[];

  assert.ok(rows.length > 0, 'medical_history não tem as colunas da anamnese');
  for (const r of rows) {
    assert.equal(r.data_type, 'text', `medical_history.${r.column_name} devia ser TEXT e é ${r.data_type}`);
  }
});

test('nenhuma tabela ficou com o par de nomes antigo ao lado do novo', async () => {
  // Se os dois pares coexistirem, a migração 057 criou colunas em vez de renomear e
  // os dados históricos ficaram na coluna que o código já não lê.
  const rows = (await query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='lab_orders'    AND column_name IN ('ordered_at','ordered_by'))
          OR (table_name='prescriptions' AND column_name IN ('prescribed_at','prescribed_by')))`,
  )) as { table_name: string; column_name: string }[];

  assert.deepEqual(
    rows.map((r) => `${r.table_name}.${r.column_name}`),
    [],
    'colunas com o nome antigo ainda presentes — os dados históricos ficaram fora do alcance do código',
  );
});
