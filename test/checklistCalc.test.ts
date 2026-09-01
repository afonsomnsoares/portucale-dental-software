import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countChecked, isRunComplete, snapshotItems, toggleItem } from '../lib/checklistCalc.ts';

test('snapshotItems: cria um item por label, todos por marcar', () => {
  const items = snapshotItems(['Ligar compressor', 'Verificar stock de luvas']);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.checked === false && i.checkedBy === null && i.checkedAt === null));
  assert.equal(items[0].label, 'Ligar compressor');
});

test('snapshotItems: lista vazia devolve array vazio', () => {
  assert.deepEqual(snapshotItems([]), []);
});

test('toggleItem: marcar regista quem e quando', () => {
  const items = snapshotItems(['A', 'B']);
  const now = new Date('2026-08-31T08:00:00.000Z');
  const next = toggleItem(items, 0, true, 'user-1', 'Ana', now);
  assert.equal(next[0].checked, true);
  assert.equal(next[0].checkedBy, 'user-1');
  assert.equal(next[0].checkedByName, 'Ana');
  assert.equal(next[0].checkedAt, now.toISOString());
  // item não tocado fica inalterado
  assert.equal(next[1].checked, false);
});

test('toggleItem: desmarcar limpa o carimbo de quem/quando', () => {
  const now = new Date('2026-08-31T08:00:00.000Z');
  const checked = toggleItem(snapshotItems(['A']), 0, true, 'user-1', 'Ana', now);
  const unchecked = toggleItem(checked, 0, false, 'user-1', 'Ana', now);
  assert.equal(unchecked[0].checked, false);
  assert.equal(unchecked[0].checkedBy, null);
  assert.equal(unchecked[0].checkedByName, null);
  assert.equal(unchecked[0].checkedAt, null);
});

test('toggleItem: não muta o array original', () => {
  const items = snapshotItems(['A']);
  const now = new Date();
  toggleItem(items, 0, true, 'user-1', 'Ana', now);
  assert.equal(items[0].checked, false, 'o array de entrada não deve ser alterado');
});

test('toggleItem: índice fora dos limites devolve os items inalterados', () => {
  const items = snapshotItems(['A', 'B']);
  const next = toggleItem(items, 5, true, 'user-1', 'Ana', new Date());
  assert.deepEqual(next, items);
});

test('isRunComplete: falso enquanto houver pelo menos um item por marcar', () => {
  const items = toggleItem(snapshotItems(['A', 'B']), 0, true, 'u1', 'Ana', new Date());
  assert.equal(isRunComplete(items), false);
});

test('isRunComplete: verdadeiro quando todos os items estão marcados', () => {
  let items = snapshotItems(['A', 'B']);
  items = toggleItem(items, 0, true, 'u1', 'Ana', new Date());
  items = toggleItem(items, 1, true, 'u1', 'Ana', new Date());
  assert.equal(isRunComplete(items), true);
});

test('isRunComplete: uma checklist sem items nunca está completa', () => {
  assert.equal(isRunComplete([]), false);
});

test('countChecked: conta apenas os items marcados', () => {
  let items = snapshotItems(['A', 'B', 'C']);
  items = toggleItem(items, 0, true, 'u1', 'Ana', new Date());
  items = toggleItem(items, 2, true, 'u1', 'Ana', new Date());
  assert.equal(countChecked(items), 2);
});
