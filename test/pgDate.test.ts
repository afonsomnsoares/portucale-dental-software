import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, requireIsoDate } from '../lib/pgDate.ts';

// O bug que estes testes existem para impedir está escrito por extenso em lib/pgDate.ts.
// Em resumo: uma coluna DATE chegava como `Date` à meia-noite local, e
// `String(...).slice(0, 10)` devolvia "Wed Aug 05" em vez de "2026-08-05" — sem estoirar.

test('isoDate: um Date à meia-noite local devolve o dia de calendário, não o dia em UTC', () => {
  // É assim que o node-postgres devolvia uma coluna DATE antes do type parser em
  // lib/db.ts: meia-noite LOCAL. Em Lisboa, no verão, isso é 23:00Z do dia anterior —
  // por isso ler os componentes UTC devolveria 4 de agosto.
  const localMidnight = new Date(2026, 7, 5, 0, 0, 0);
  assert.equal(isoDate(localMidnight), '2026-08-05');
});

test('isoDate: o último instante do dia continua a ser o mesmo dia', () => {
  assert.equal(isoDate(new Date(2026, 7, 5, 23, 59, 59)), '2026-08-05');
});

test('isoDate: aceita a string ISO que o Postgres devolve com o parser instalado', () => {
  assert.equal(isoDate('2026-08-05'), '2026-08-05');
  assert.equal(isoDate('2026-08-05T00:00:00.000Z'), '2026-08-05');
});

test('isoDate: recusa o formato que era exatamente o bug', () => {
  // Se alguma vez voltar a entrar um `Date` impresso por extenso, isto devolve null
  // em vez de o deixar passar para dentro de um SMS ou de uma cláusula WHERE.
  assert.equal(isoDate('Wed Aug 05'), null);
  assert.equal(isoDate('Wed Aug 05 2026 00:00:00 GMT+0100 (WEST)'), null);
});

test('isoDate: ausência é null, não epoch', () => {
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(undefined), null);
  assert.equal(isoDate(''), null);
  assert.equal(isoDate(new Date('nonsense')), null);
});

test('isoDate: um mês/dia de um só dígito leva zero à frente', () => {
  assert.equal(isoDate(new Date(2026, 0, 9)), '2026-01-09');
});

test('isoDate: atravessa a mudança para a hora de verão sem saltar um dia', () => {
  // Em 2026 a hora de verão em Portugal começa a 29 de março. O dia 29 tem 23 horas,
  // que é onde a aritmética de +86400000ms tropeça.
  assert.equal(isoDate(new Date(2026, 2, 28)), '2026-03-28');
  assert.equal(isoDate(new Date(2026, 2, 29)), '2026-03-29');
  assert.equal(isoDate(new Date(2026, 2, 30)), '2026-03-30');
  // E o regresso, a 25 de outubro, num dia de 25 horas.
  assert.equal(isoDate(new Date(2026, 9, 25)), '2026-10-25');
});

test('requireIsoDate: estoira com uma mensagem que diz como corrigir a query', () => {
  assert.throws(() => requireIsoDate('Wed Aug 05', 'appt_date'), /appt_date::text/);
  assert.throws(() => requireIsoDate(null, 'offered_date'), /offered_date/);
});

test('requireIsoDate: deixa passar o que é válido', () => {
  assert.equal(requireIsoDate('2026-08-05'), '2026-08-05');
  assert.equal(requireIsoDate(new Date(2026, 7, 5)), '2026-08-05');
});

test('a comparação de strings que o código faz só funciona no formato ISO', () => {
  // A guarda `isFuture` em app/api/appointments/[id]/route.ts compara datas como
  // strings. Isso é legítimo em ISO — e era sempre verdadeiro no formato antigo,
  // porque "W" > "2". É o que tornava toda a consulta cancelada "futura".
  assert.equal('2026-08-05' > '2026-01-01', true);
  assert.equal('2025-12-31' > '2026-01-01', false);
  assert.equal('Wed Aug 05' > '2026-01-01', true, 'o formato antigo mentia aqui');
});
