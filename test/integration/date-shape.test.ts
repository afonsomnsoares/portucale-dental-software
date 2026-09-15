// Varredura de forma das colunas DATE. Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// ─── Porque é que este ficheiro existe ──────────────────────────────────────
// Durante meses as previsões devolveram zero, a lista de espera excluiu em silêncio
// quem tinha dias preferidos, e a interface mostrou o dia anterior de março a outubro.
// Era tudo a mesma causa: o node-postgres devolvia uma coluna DATE como `Date` à
// meia-noite local, e o código tratava-a como se fosse uma string ISO.
//
// Os 631 testes unitários não podiam ver isto: cada fixture de `*Calc.ts` passa
// '2026-08-05' já como string, por isso as funções puras estavam — e continuam —
// corretas. O defeito vivia inteiro na costura entre o SQL e a camada de cálculo,
// que é precisamente o que um teste unitário não atravessa.
//
// Este teste corre contra o Postgres a sério e verifica a forma, não o valor. É
// barato e apanha a classe toda, incluindo o sítio número 39 que alguém escrever
// para o mês que vem.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { isoDate } from '../../lib/pgDate.ts';
import { closeTestDb, ensureSeeded } from '../helpers/testDb.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

before(async () => {
  await ensureSeeded();
});

after(async () => {
  await closeTestDb();
});

test('o type parser de DATE está instalado — uma coluna DATE chega como string ISO', async () => {
  const rows = await query(`SELECT '2026-08-05'::date AS d`);
  const d = (rows[0] as Record<string, unknown>).d;
  assert.equal(typeof d, 'string', 'uma coluna DATE tem de chegar como string, não como Date');
  assert.match(d as string, ISO);
  assert.equal(d, '2026-08-05');
});

test('TIMESTAMP continua a ser Date — o parser não pode ter apanhado os instantes', async () => {
  // DATE é um dia de calendário; TIMESTAMP é um instante. Só o primeiro é que muda.
  const rows = await query(`SELECT NOW() AS ts, NOW()::timestamp AS ts_naive`);
  const r = rows[0] as Record<string, unknown>;
  assert.ok(r.ts instanceof Date, 'TIMESTAMPTZ deve continuar a ser Date');
  assert.ok(r.ts_naive instanceof Date, 'TIMESTAMP deve continuar a ser Date');
});

test('o dia de verão não recua ao ser serializado para o cliente', async () => {
  // Este é o bug que a interface mostrava: `Response.json()` serializava o `Date` em
  // UTC, e a meia-noite de 5 de agosto em Lisboa é 4 de agosto às 23:00Z.
  const rows = await query(`SELECT '2026-08-05'::date AS verao, '2026-01-15'::date AS inverno`);
  const r = rows[0] as Record<string, unknown>;
  const payload = JSON.parse(JSON.stringify(r)) as Record<string, string>;

  assert.equal(String(payload.verao).slice(0, 10), '2026-08-05', 'hora de verão (WEST)');
  assert.equal(String(payload.inverno).slice(0, 10), '2026-01-15', 'hora de inverno (WET)');
});

test('todas as colunas DATE do esquema chegam em ISO, em todas as linhas semeadas', async () => {
  const cols = (await query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public'
        AND c.data_type = 'date'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.column_name`,
  )) as { table_name: string; column_name: string }[];

  assert.ok(cols.length > 0, 'esperava-se encontrar colunas DATE no esquema');

  const bad: string[] = [];
  let checked = 0;

  for (const { table_name, column_name } of cols) {
    // Identificadores vêm do information_schema, não de input — mas cita-se à mesma.
    const rows = (await query(
      `SELECT "${column_name}" AS v FROM "${table_name}" WHERE "${column_name}" IS NOT NULL LIMIT 25`,
    )) as { v: unknown }[];

    for (const { v } of rows) {
      checked += 1;
      if (typeof v !== 'string' || !ISO.test(v)) {
        bad.push(`${table_name}.${column_name} = ${JSON.stringify(v)} (${typeof v})`);
        break;
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    `colunas DATE que não chegaram como string ISO:\n  ${bad.join('\n  ')}\n` +
      'Ver o type parser em lib/db.ts.',
  );
  assert.ok(checked > 0, 'nenhuma linha com data foi verificada — a base semeada tem datas?');
});

test('isoDate concorda com o que a base devolve, em qualquer um dos dois formatos', async () => {
  const rows = await query(`SELECT '2026-08-05'::date AS d`);
  const fromDb = (rows[0] as Record<string, unknown>).d;

  assert.equal(isoDate(fromDb), '2026-08-05');
  // E o mesmo dia escrito como o pg o dava antigamente.
  assert.equal(isoDate(new Date(2026, 7, 5)), '2026-08-05');
});
