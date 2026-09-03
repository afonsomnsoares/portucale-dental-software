import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampInsights } from '../lib/agents/insightCalc.ts';

const KINDS = ['revenue_drop', 'no_show_spike'];
const OPTS = { allowedKinds: KINDS, maxImpactEur: 10000 };

test('clampInsights: aceita uma conclusão válida', () => {
  const out = clampInsights(
    [{ kind: 'revenue_drop', severity: 'warning', title: 'Receita a cair', body: 'Menos 12%.', impactEur: 3200 }],
    OPTS,
  );
  assert.deepEqual(out, [
    { kind: 'revenue_drop', severity: 'warning', title: 'Receita a cair', body: 'Menos 12%.', impactEur: 3200 },
  ]);
});

test('clampInsights: descarta um valor em euros acima do teto (número inventado)', () => {
  const out = clampInsights(
    [{ kind: 'revenue_drop', severity: 'critical', title: 'Perda enorme', body: 'x', impactEur: 4_000_000 }],
    OPTS,
  );
  assert.equal(out.length, 1, 'o texto fica');
  assert.equal(out[0].impactEur, null, 'o número inventado cai');
});

test('clampInsights: ignora um kind fora da lista fechada do agente', () => {
  const out = clampInsights([{ kind: 'inventado', severity: 'info', title: 'Olá', body: '' }], OPTS);
  assert.deepEqual(out, []);
});

test('clampInsights: severity inválida cai para info em vez de rejeitar a conclusão', () => {
  const out = clampInsights([{ kind: 'no_show_spike', severity: 'apocalipse', title: 'Faltas', body: '' }], OPTS);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'info');
});

test('clampInsights: sem título é rejeitada', () => {
  const out = clampInsights([{ kind: 'no_show_spike', severity: 'warning', title: '   ', body: 'algo' }], OPTS);
  assert.deepEqual(out, []);
});

test('clampInsights: impactEur negativo ou zero fica null', () => {
  const out = clampInsights([{ kind: 'no_show_spike', severity: 'info', title: 'T', body: '', impactEur: -5 }], OPTS);
  assert.equal(out[0].impactEur, null);
});

test('clampInsights: respeita o maxItems', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    kind: 'revenue_drop',
    severity: 'info',
    title: `T${i}`,
    body: '',
  }));
  const out = clampInsights(many, { ...OPTS, maxItems: 3 });
  assert.equal(out.length, 3);
});

test('clampInsights: título e corpo são cortados a 160/1200', () => {
  const out = clampInsights(
    [{ kind: 'revenue_drop', severity: 'info', title: 'x'.repeat(300), body: 'y'.repeat(2000) }],
    OPTS,
  );
  assert.equal(out[0].title.length, 160);
  assert.equal(out[0].body.length, 1200);
});

test('clampInsights: lista vazia ou nula devolve lista vazia', () => {
  assert.deepEqual(clampInsights([], OPTS), []);
  assert.deepEqual(clampInsights(null, OPTS), []);
});

test('clampInsights: com teto zero, nenhum euro passa (agentes que não medem dinheiro)', () => {
  const out = clampInsights([{ kind: 'revenue_drop', severity: 'info', title: 'T', body: '', impactEur: 100 }], {
    ...OPTS,
    maxImpactEur: 0,
  });
  assert.equal(out[0].impactEur, null);
});
