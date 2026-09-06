import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_DEVIATION_PCT, attributeCause, describeCause, detectAnomaly } from '../lib/anomalyCalc.ts';

test('o normal não dispara', () => {
  const history = [100, 102, 98, 101, 99, 100, 103];
  assert.equal(detectAnomaly(101, history), null);
});

test('histórico curto não afirma o que é normal', () => {
  assert.equal(detectAnomaly(500, [100, 100, 100]), null, 'três pontos não definem normalidade');
});

test('uma queda real dispara, com direção e magnitude', () => {
  const history = [100, 102, 98, 101, 99, 100, 103];
  const a = detectAnomaly(70, history);
  assert.ok(a);
  assert.equal(a.direction, 'down');
  assert.equal(a.baseline, 100);
  assert.equal(a.deviationPct, 30);
});

test('a mesma queda pesa diferente conforme a clínica é estável ou irregular', () => {
  // É esta a razão de existir do módulo: 30% não é um limiar universal. Numa clínica
  // que nunca oscila mais de 3%, uma queda de 30% é uma emergência. Numa que oscila
  // entre 40 e 160 todas as semanas, é terça-feira.
  const estavel = detectAnomaly(70, [100, 102, 98, 101, 99, 100, 103]);
  const irregular = detectAnomaly(70, [100, 160, 40, 130, 55, 145, 60]);

  assert.ok(estavel);
  assert.ok(irregular);
  assert.equal(estavel.deviationPct, irregular.deviationPct, 'a mesma queda em percentagem');
  assert.equal(estavel.severity, 'critical');
  assert.equal(irregular.severity, 'warning');
  assert.ok(estavel.score > irregular.score, 'o que muda é quanto isso destoa do costume');
});

test('uma subida também é anomalia — nem toda a anomalia é má notícia', () => {
  const a = detectAnomaly(160, [100, 102, 98, 101, 99, 100]);
  assert.ok(a);
  assert.equal(a.direction, 'up');
  assert.equal(a.severity, 'critical', '60% acima do normal merece atenção imediata');
});

test('variação abaixo do mínimo é ruído, não anomalia', () => {
  const history = [100, 100, 100, 100, 100, 100];
  // Histórico perfeitamente constante: sem o piso de MIN_DEVIATION_PCT, 3% dispararia.
  assert.equal(detectAnomaly(103, history), null);
  assert.ok(detectAnomaly(100 + MIN_DEVIATION_PCT + 1, history), 'acima do piso já dispara');
});

test('um outlier passado não cega o detetor (a razão de usar MAD)', () => {
  // Uma semana catastrófica no histórico. Com desvio-padrão, a dispersão alargava ao
  // ponto de a queda seguinte passar por normal.
  const history = [100, 102, 98, 101, 99, 0, 100, 101];
  const a = detectAnomaly(60, history);
  assert.ok(a, 'a queda seguinte tem de continuar a disparar');
  assert.equal(a.direction, 'down');
});

test('linha de base zero não produz percentagens infinitas', () => {
  assert.equal(detectAnomaly(50, [0, 0, 0, 0, 0, 0]), null);
});

test('attributeCause aponta quem mais pesou, não quem mais caiu em percentagem', () => {
  const before = [
    { label: 'Dr. Silva', value: 100 },
    { label: 'Dr. Costa', value: 2 },
  ];
  const after = [
    { label: 'Dr. Silva', value: 60 },
    { label: 'Dr. Costa', value: 1 },
  ];
  const causes = attributeCause(before, after);
  // Costa caiu 50% e Silva 40% — mas Silva explica 40 dos 41 pontos perdidos.
  assert.equal(causes[0].label, 'Dr. Silva');
  assert.equal(causes[0].delta, -40);
  assert.ok(causes[0].sharePct > 90);
});

test('segmentos que se moveram ao contrário não explicam a variação', () => {
  const before = [
    { label: 'Cadeira 1', value: 100 },
    { label: 'Cadeira 2', value: 50 },
  ];
  const after = [
    { label: 'Cadeira 1', value: 40 },
    { label: 'Cadeira 2', value: 70 },
  ];
  const causes = attributeCause(before, after);
  assert.equal(causes.length, 1);
  assert.equal(causes[0].label, 'Cadeira 1', 'a cadeira que subiu não explica uma queda');
});

test('segmentos novos e desaparecidos são tratados como zero do outro lado', () => {
  const causes = attributeCause([{ label: 'Implantologia', value: 80 }], [{ label: 'Ortodontia', value: 10 }]);
  assert.equal(causes[0].label, 'Implantologia');
  assert.equal(causes[0].after, 0, 'desapareceu = caiu a zero');
});

test('para quando já explicou o suficiente', () => {
  const before = [
    { label: 'A', value: 100 },
    { label: 'B', value: 100 },
    { label: 'C', value: 100 },
    { label: 'D', value: 100 },
  ];
  const after = [
    { label: 'A', value: 10 },
    { label: 'B', value: 95 },
    { label: 'C', value: 97 },
    { label: 'D', value: 99 },
  ];
  const causes = attributeCause(before, after);
  assert.equal(causes[0].label, 'A');
  assert.ok(causes.length <= 3, 'três causas que explicam a maioria dizem mais do que doze');
});

test('sem variação não há causa que atribuir', () => {
  const same = [{ label: 'A', value: 10 }];
  assert.deepEqual(attributeCause(same, same), []);
  assert.equal(describeCause([]), '');
});

test('describeCause produz frase legível', () => {
  const causes = attributeCause(
    [
      { label: 'Dr. Silva', value: 100 },
      { label: 'Cadeira 3', value: 60 },
    ],
    [
      { label: 'Dr. Silva', value: 50 },
      { label: 'Cadeira 3', value: 40 },
    ],
  );
  const s = describeCause(causes);
  assert.match(s, /^sobretudo /);
  assert.match(s, /Dr\. Silva \(\d+(\.\d+)?%\)/);
  assert.match(s, / e /);
});
