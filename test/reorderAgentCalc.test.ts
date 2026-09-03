import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampAiReorderDecision, type ReorderCandidate } from '../lib/agents/reorderAgentCalc.ts';

const CANDIDATES: ReorderCandidate[] = [
  { itemId: 1, itemName: 'Luvas nitrilo M', suggestedReorderQty: 100 },
  { itemId: 2, itemName: 'Anestesia', suggestedReorderQty: 20 },
];

test('clampAiReorderDecision: aceita uma quantidade dentro do limite', () => {
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 1, quantity: 150, reason: 'consumo a subir' }]);
  assert.deepEqual(out, [{ itemId: 1, quantity: 150, reason: 'consumo a subir' }]);
});

test('clampAiReorderDecision: corta no dobro da sugestão determinística', () => {
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 1, quantity: 10000, reason: 'alucinação' }]);
  assert.equal(out[0].quantity, 200); // 2x de 100
});

test('clampAiReorderDecision: ignora um item fora do espaço de candidatos', () => {
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 999, quantity: 10, reason: 'inventado' }]);
  assert.deepEqual(out, []);
});

test('clampAiReorderDecision: quantidade zero ou negativa é omissão, não erro', () => {
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 1, quantity: 0, reason: 'já tem lote a chegar' }]);
  assert.deepEqual(out, []);
});

test('clampAiReorderDecision: a IA pode omitir um item — não é preenchido pela regra fixa', () => {
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 1, quantity: 100 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].itemId, 1);
});

test('clampAiReorderDecision: um itemId duplicado só conta uma vez', () => {
  const out = clampAiReorderDecision(CANDIDATES, [
    { itemId: 1, quantity: 50 },
    { itemId: 1, quantity: 999 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 50);
});

test('clampAiReorderDecision: itemId ou quantity não numéricos são ignorados sem rebentar', () => {
  const out = clampAiReorderDecision(CANDIDATES, [
    { itemId: 'abc', quantity: 10 },
    { itemId: 2, quantity: 'muitas' },
  ] as never);
  assert.deepEqual(out, []);
});

test('clampAiReorderDecision: lista vazia ou nula devolve lista vazia', () => {
  assert.deepEqual(clampAiReorderDecision(CANDIDATES, []), []);
  assert.deepEqual(clampAiReorderDecision(CANDIDATES, null), []);
});

test('clampAiReorderDecision: reason é cortado a 300 caracteres', () => {
  const long = 'x'.repeat(500);
  const out = clampAiReorderDecision(CANDIDATES, [{ itemId: 2, quantity: 5, reason: long }]);
  assert.equal(out[0].reason.length, 300);
});
