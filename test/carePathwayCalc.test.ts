import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dueStepsFor,
  isPhaseApplicable,
  isStepSatisfied,
  type PathwayContext,
  type PathwayEvidence,
  type PathwayStep,
  previewPathway,
  stepKey,
  validatePathwaySteps,
} from '../lib/carePathwayCalc.ts';

function step(over: Partial<PathwayStep> & { id: string }): PathwayStep {
  return {
    position: 1,
    phase: 'pre',
    action: 'task',
    title: 'Confirmar jejum',
    offsetDays: -1,
    roles: ['receptionist'],
    blocking: false,
    reference: null,
    ...over,
  };
}

const CONSULTA: PathwayContext = {
  appointmentId: 'a1',
  patientId: 'p1',
  patientName: 'Ana Ribeiro',
  apptDate: '2026-03-10',
  type: 'Implante',
  status: 'confirmed',
};

function evidence(over: Partial<PathwayEvidence> = {}): PathwayEvidence {
  return {
    satisfiedStepIds: new Set<string>(),
    signedConsents: new Set<string>(),
    generatedDocuments: new Set<string>(),
    missingFields: [],
    activeRecalls: new Set<string>(),
    ...over,
  };
}

// ─── Fases ──────────────────────────────────────────────────────────────────

test('os passos pós-consulta só se aplicam a uma consulta realizada', () => {
  assert.equal(isPhaseApplicable('post', 'departed'), true);
  assert.equal(isPhaseApplicable('post', 'confirmed'), false);
  assert.equal(isPhaseApplicable('post', 'no-show'), false);
});

test('os passos pré-consulta não se aplicam a quem faltou', () => {
  assert.equal(isPhaseApplicable('pre', 'confirmed'), true);
  assert.equal(isPhaseApplicable('pre', 'waiting'), true);
  assert.equal(isPhaseApplicable('pre', 'no-show'), false);
});

// ─── Prazos ─────────────────────────────────────────────────────────────────

test('um passo só fica devido quando a data chega', () => {
  const s = step({ id: 'jejum', offsetDays: -2 });
  assert.equal(dueStepsFor(CONSULTA, [s], evidence(), '2026-03-07').length, 0);
  assert.equal(dueStepsFor(CONSULTA, [s], evidence(), '2026-03-08').length, 1);
});

test('um passo devido continua devido depois do prazo', () => {
  const s = step({ id: 'jejum', offsetDays: -2 });
  assert.equal(dueStepsFor(CONSULTA, [s], evidence(), '2026-03-09').length, 1);
});

test('um passo pós-consulta conta a partir da consulta', () => {
  const s = step({ id: 'controlo', phase: 'post', offsetDays: 7, action: 'task' });
  const feita = { ...CONSULTA, status: 'departed' };
  assert.equal(dueStepsFor(feita, [s], evidence(), '2026-03-16').length, 0);
  const [devido] = dueStepsFor(feita, [s], evidence(), '2026-03-17');
  assert.equal(devido.dueDate, '2026-03-17');
});

// ─── Idempotência ───────────────────────────────────────────────────────────
// A propriedade que permite correr isto de hora a hora sem inundar a clínica.

test('um passo com marcador já criado não volta a ser devido', () => {
  const s = step({ id: 'jejum' });
  const ev = evidence({ satisfiedStepIds: new Set([stepKey('a1', 'jejum')]) });
  assert.deepEqual(dueStepsFor(CONSULTA, [s], ev, '2026-03-10'), []);
});

test('um consentimento assinado por fora satisfaz o passo sozinho', () => {
  const s = step({ id: 'consent', action: 'consent', reference: 'implante' });
  assert.equal(isStepSatisfied(s, evidence(), 'a1'), false);
  assert.equal(isStepSatisfied(s, evidence({ signedConsents: new Set(['implante']) }), 'a1'), true);
});

test('um documento já gerado satisfaz o passo', () => {
  const s = step({ id: 'doc', action: 'document', reference: 'orcamento' });
  assert.equal(isStepSatisfied(s, evidence({ generatedDocuments: new Set(['orcamento']) }), 'a1'), true);
});

test('um recall já ativo satisfaz o passo', () => {
  const s = step({ id: 'recall', phase: 'post', offsetDays: 1, action: 'recall', reference: 'higiene' });
  assert.equal(isStepSatisfied(s, evidence({ activeRecalls: new Set(['higiene']) }), 'a1'), true);
});

test('o passo de dados em falta satisfaz-se pela ausência do problema', () => {
  const s = step({ id: 'dados', action: 'missing_data' });
  assert.equal(isStepSatisfied(s, evidence({ missingFields: [] }), 'a1'), true);
  assert.equal(isStepSatisfied(s, evidence({ missingFields: ['Telefone'] }), 'a1'), false);
});

test('a chave é estável entre corridas — é isso que a torna um marcador utilizável', () => {
  assert.equal(stepKey('a1', 'jejum'), stepKey('a1', 'jejum'));
  assert.notEqual(stepKey('a1', 'jejum'), stepKey('a2', 'jejum'));
});

// ─── Ordem ──────────────────────────────────────────────────────────────────

test('os bloqueantes vêm à frente, depois a consulta mais próxima, depois a posição', () => {
  const passos = [
    step({ id: 'rotina', position: 1, blocking: false }),
    step({ id: 'consentimento', position: 9, blocking: true, action: 'consent', reference: 'implante' }),
  ];
  const devidos = dueStepsFor(CONSULTA, passos, evidence(), '2026-03-10');
  assert.deepEqual(
    devidos.map((d) => d.step.id),
    ['consentimento', 'rotina'],
  );
});

// ─── O exemplo concreto ─────────────────────────────────────────────────────
// "implante amanhã → gerar consentimento, confirmar jejum, verificar dados em falta"

test('um implante para amanhã produz exatamente os três passos', () => {
  const percurso = [
    step({ id: 'consent', position: 1, action: 'consent', reference: 'implante', blocking: true, offsetDays: -3, title: 'Consentimento de implante' }),
    step({ id: 'jejum', position: 2, action: 'task', offsetDays: -1, title: 'Confirmar jejum' }),
    step({ id: 'dados', position: 3, action: 'missing_data', offsetDays: -3, title: 'Verificar dados em falta' }),
  ];
  const devidos = dueStepsFor(CONSULTA, percurso, evidence({ missingFields: ['Morada'] }), '2026-03-09');
  assert.deepEqual(
    devidos.map((d) => d.step.id),
    ['consent', 'jejum', 'dados'],
  );
  assert.match(devidos[0].reason, /consentimento "implante" por assinar/);
  assert.match(devidos[2].reason, /faltam Morada/);
});

test('no dia seguinte, com o consentimento assinado, só sobram dois', () => {
  const percurso = [
    step({ id: 'consent', action: 'consent', reference: 'implante', offsetDays: -3 }),
    step({ id: 'jejum', action: 'task', offsetDays: -1 }),
    step({ id: 'dados', action: 'missing_data', offsetDays: -3 }),
  ];
  const devidos = dueStepsFor(
    CONSULTA,
    percurso,
    evidence({ signedConsents: new Set(['implante']), missingFields: ['Morada'] }),
    '2026-03-09',
  );
  assert.deepEqual(devidos.map((d) => d.step.id).sort(), ['dados', 'jejum']);
});

// ─── Pré-visualização ───────────────────────────────────────────────────────

test('previewPathway ordena por prazo e escreve o relativo em português', () => {
  const entradas = previewPathway(
    [
      step({ id: 'depois', phase: 'post', offsetDays: 7 }),
      step({ id: 'antes', offsetDays: -1 }),
      step({ id: 'dia', offsetDays: 0 }),
    ],
    '2026-03-10',
  );
  assert.deepEqual(
    entradas.map((e) => [e.step.id, e.date, e.relative]),
    [
      ['antes', '2026-03-09', '1 dia antes'],
      ['dia', '2026-03-10', 'no próprio dia'],
      ['depois', '2026-03-17', '7 dias depois'],
    ],
  );
});

// ─── Validação ──────────────────────────────────────────────────────────────

test('um passo pré-consulta com prazo depois da consulta é sempre um lapso de sinal', () => {
  const erros = validatePathwaySteps([step({ id: 'x', phase: 'pre', offsetDays: 2, title: 'Confirmar jejum' })]);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /prazo depois da consulta/);
});

test('um passo pós-consulta com prazo negativo também', () => {
  const erros = validatePathwaySteps([step({ id: 'x', phase: 'post', offsetDays: -2, title: 'Controlo' })]);
  assert.match(erros[0], /prazo antes da consulta/);
});

test('um consentimento sem indicar qual ficaria devido para sempre', () => {
  const erros = validatePathwaySteps([step({ id: 'x', action: 'consent', reference: null, title: 'Consentimento' })]);
  assert.match(erros[0], /precisa de indicar qual/);
});

test('ids duplicados são apanhados antes de gravar', () => {
  const erros = validatePathwaySteps([step({ id: 'x' }), step({ id: 'x' })]);
  assert.match(erros[0], /duplicado/);
});

test('um template correto passa sem erros', () => {
  assert.deepEqual(
    validatePathwaySteps([
      step({ id: 'a', phase: 'pre', offsetDays: -2 }),
      step({ id: 'b', phase: 'post', offsetDays: 1, action: 'recall', reference: 'higiene' }),
    ]),
    [],
  );
});
