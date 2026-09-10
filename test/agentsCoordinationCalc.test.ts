import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTS } from '../lib/agents/registry.ts';
import {
  arbitrateContacts,
  CONTACT_PRIORITY,
  type ContactRequest,
  coordinateContacts,
  isIncoherent,
  isOperational,
  MAX_CONTACTS_PER_DAY,
  MAX_PROMOTIONAL_CONTACTS_PER_WEEK,
  type PatientContactState,
  priorityOf,
  type SharedPatientContext,
  summarizeCoordination,
} from '../lib/agents/coordinationCalc.ts';

function pedido(over: Partial<ContactRequest> & { kind: string }): ContactRequest {
  return {
    agentId: 'patient',
    patientId: 'p1',
    dedupeKey: 'k1',
    body: 'Olá',
    ...over,
  } as ContactRequest;
}

function estado(over: Partial<PatientContactState> = {}): PatientContactState {
  return { patientId: 'p1', contactsToday: 0, promotionalThisWeek: 0, canContact: true, ...over };
}

function contexto(over: Partial<SharedPatientContext> = {}): SharedPatientContext {
  return {
    patientId: 'p1',
    name: 'Ana',
    engagement: 60,
    churnRisk: 50,
    bookingPropensity: 50,
    journeyStage: 'recall_due',
    hasFutureAppointment: false,
    lastContactAt: null,
    contactsToday: 0,
    promotionalThisWeek: 0,
    canContact: true,
    ...over,
  };
}

// ─── Prioridade ─────────────────────────────────────────────────────────────

test('a prioridade é sobre o que se perde por esperar, não sobre euros', () => {
  assert.ok(priorityOf('waitlist_offer') < priorityOf('plan_followup'));
  assert.ok(priorityOf('appointment_reminder') < priorityOf('plan_followup'));
  assert.ok(priorityOf('recall_reminder') < priorityOf('lifecycle_reactivation'));
});

// Um agente novo não pode passar à frente dos existentes por ninguém se ter lembrado
// de o classificar.
test('um tipo desconhecido fica no fim, nunca à frente', () => {
  assert.equal(priorityOf('inventado_amanha'), CONTACT_PRIORITY.length);
  assert.ok(priorityOf('inventado_amanha') > priorityOf('lifecycle_reactivation'));
});

test('os contactos operacionais distinguem-se dos promocionais', () => {
  assert.ok(isOperational('appointment_reminder'));
  assert.ok(isOperational('waitlist_offer'));
  assert.equal(isOperational('lifecycle_reactivation'), false);
  assert.equal(isOperational('plan_followup'), false);
});

// ─── O caso que motivou o ficheiro ──────────────────────────────────────────

test('os cinco SMS do mesmo dia passam a ser um', () => {
  const decisoes = arbitrateContacts(
    [
      pedido({ agentId: 'patient', kind: 'lifecycle_reactivation', dedupeKey: 'lc' }),
      pedido({ agentId: 'patient', kind: 'recall_reminder', dedupeKey: 'rc' }),
      pedido({ agentId: 'patient', kind: 'plan_followup', dedupeKey: 'pl' }),
      pedido({ agentId: 'scheduling', kind: 'risk_outreach', dedupeKey: 'ro' }),
      pedido({ agentId: 'scheduling', kind: 'appointment_reminder', dedupeKey: 'ap' }),
    ],
    new Map([['p1', estado()]]),
  );
  const concedidos = decisoes.filter((d) => d.granted);
  assert.equal(concedidos.length, MAX_CONTACTS_PER_DAY);
  assert.equal(concedidos[0].request.kind, 'appointment_reminder', 'o mais perecível ganha');
  assert.ok(decisoes.filter((d) => !d.granted).every((d) => 'deferred' in d && d.deferred));
});

test('quem perde é diferido, não descartado — a razão dele continua a existir', () => {
  const [, ...perdedores] = arbitrateContacts(
    [
      pedido({ kind: 'appointment_reminder', dedupeKey: 'ap' }),
      pedido({ kind: 'plan_followup', dedupeKey: 'pl' }),
    ],
    new Map([['p1', estado()]]),
  );
  assert.equal(perdedores.length, 1);
  assert.equal(perdedores[0].granted, false);
  assert.ok(!perdedores[0].granted && perdedores[0].deferred);
  assert.match(perdedores[0].granted === false ? perdedores[0].reason : '', /fica para amanhã/);
});

test('doentes diferentes não competem entre si', () => {
  const decisoes = arbitrateContacts(
    [
      pedido({ patientId: 'p1', kind: 'recall_reminder' }),
      pedido({ patientId: 'p2', kind: 'recall_reminder' }),
    ],
    new Map([
      ['p1', estado({ patientId: 'p1' })],
      ['p2', estado({ patientId: 'p2' })],
    ]),
  );
  assert.equal(decisoes.filter((d) => d.granted).length, 2);
});

test('um contacto já enviado hoje por fora conta para o orçamento', () => {
  const [d] = arbitrateContacts([pedido({ kind: 'appointment_reminder' })], new Map([['p1', estado({ contactsToday: 1 })]]));
  assert.equal(d.granted, false);
});

// ─── Orçamento semanal ──────────────────────────────────────────────────────

test('o teto semanal só se aplica aos promocionais', () => {
  const cheio = estado({ promotionalThisWeek: MAX_PROMOTIONAL_CONTACTS_PER_WEEK });
  const [promocional] = arbitrateContacts([pedido({ kind: 'lifecycle_reactivation' })], new Map([['p1', cheio]]));
  assert.equal(promocional.granted, false);

  const [operacional] = arbitrateContacts([pedido({ kind: 'appointment_reminder' })], new Map([['p1', cheio]]));
  assert.equal(operacional.granted, true, 'um doente em tratamento ativo não pode ficar sem lembretes');
});

// ─── Consentimento ──────────────────────────────────────────────────────────

test('sem consentimento a recusa é definitiva, não um adiamento', () => {
  const [d] = arbitrateContacts([pedido({ kind: 'appointment_reminder' })], new Map([['p1', estado({ canContact: false })]]));
  assert.equal(d.granted, false);
  assert.equal(d.granted === false && d.deferred, false, 'amanhã continua a não autorizar');
});

test('um doente sem estado nenhum não é contactado', () => {
  const [d] = arbitrateContacts([pedido({ kind: 'appointment_reminder' })], new Map());
  assert.equal(d.granted, false);
});

test('pedidos repetidos na mesma passagem contam uma vez', () => {
  const decisoes = arbitrateContacts(
    [pedido({ kind: 'recall_reminder', dedupeKey: 'r1' }), pedido({ kind: 'recall_reminder', dedupeKey: 'r1' })],
    new Map([['p1', estado()]]),
  );
  assert.equal(decisoes.filter((d) => d.granted).length, 1);
  assert.match(decisoes[1].granted === false ? decisoes[1].reason : '', /repetido/);
});

test('a arbitragem é determinística — a ordem de entrada não muda a saída', () => {
  const pedidos = [
    pedido({ kind: 'plan_followup', dedupeKey: 'a' }),
    pedido({ kind: 'plan_followup', dedupeKey: 'b' }),
  ];
  const primeira = arbitrateContacts(pedidos, new Map([['p1', estado()]]));
  const segunda = arbitrateContacts([...pedidos].reverse(), new Map([['p1', estado()]]));
  assert.equal(
    primeira.find((d) => d.granted)?.request.dedupeKey,
    segunda.find((d) => d.granted)?.request.dedupeKey,
  );
});

// ─── Coerência ──────────────────────────────────────────────────────────────

// O caso que o orçamento sozinho nunca apanharia.
test('uma reativação para quem tem consulta amanhã é incoerente, não excessiva', () => {
  const razao = isIncoherent('lifecycle_reactivation', contexto({ hasFutureAppointment: true }));
  assert.match(String(razao), /já tem consulta marcada/);
});

test('um recall para quem já marcou também', () => {
  assert.ok(isIncoherent('recall_reminder', contexto({ hasFutureAppointment: true })));
});

test('um lembrete para quem tem consulta marcada é exatamente o que deve sair', () => {
  assert.equal(isIncoherent('appointment_reminder', contexto({ hasFutureAppointment: true })), null);
});

test('reativar quem não está em risco de abandono não se aplica', () => {
  assert.ok(isIncoherent('lifecycle_reactivation', contexto({ churnRisk: 5 })));
  assert.equal(isIncoherent('lifecycle_reactivation', contexto({ churnRisk: 70 })), null);
});

// A ordem importa: uma mensagem incoerente não pode gastar a quota de uma correta.
test('a incoerência é filtrada antes do orçamento', () => {
  const decisoes = coordinateContacts(
    [
      pedido({ agentId: 'patient', kind: 'lifecycle_reactivation', dedupeKey: 'lc' }),
      pedido({ agentId: 'scheduling', kind: 'appointment_reminder', dedupeKey: 'ap' }),
    ],
    new Map([['p1', contexto({ hasFutureAppointment: true })]]),
  );
  const concedido = decisoes.find((d) => d.granted);
  assert.equal(concedido?.request.kind, 'appointment_reminder');
  const recusado = decisoes.find((d) => !d.granted);
  assert.equal(recusado?.granted === false && recusado.deferred, false, 'incoerente não se difere');
});

test('sem contexto não se contacta ninguém', () => {
  const decisoes = coordinateContacts([pedido({ kind: 'appointment_reminder' })], new Map());
  assert.equal(decisoes[0].granted, false);
});

// ─── Resumo ─────────────────────────────────────────────────────────────────

test('summarizeCoordination diz quem cedeu a quem', () => {
  const decisoes = coordinateContacts(
    [
      pedido({ agentId: 'scheduling', kind: 'appointment_reminder', dedupeKey: 'ap' }),
      pedido({ agentId: 'patient', kind: 'recall_reminder', dedupeKey: 'rc' }),
      pedido({ agentId: 'patient', kind: 'plan_followup', dedupeKey: 'pl' }),
    ],
    new Map([['p1', contexto()]]),
  );
  const resumo = summarizeCoordination(decisoes);
  assert.equal(resumo.granted, 1);
  assert.equal(resumo.deferred, 2);
  assert.equal(resumo.byAgent.scheduling.granted, 1);
  assert.equal(resumo.byAgent.patient.deferred, 2);
  assert.ok(resumo.yields.length > 0);
});

test('o resumo agrega cedências iguais em vez de as repetir', () => {
  const decisoes = coordinateContacts(
    [
      pedido({ patientId: 'p1', agentId: 'scheduling', kind: 'appointment_reminder', dedupeKey: 'a1' }),
      pedido({ patientId: 'p1', agentId: 'patient', kind: 'recall_reminder', dedupeKey: 'r1' }),
      pedido({ patientId: 'p2', agentId: 'scheduling', kind: 'appointment_reminder', dedupeKey: 'a2' }),
      pedido({ patientId: 'p2', agentId: 'patient', kind: 'recall_reminder', dedupeKey: 'r2' }),
    ],
    new Map([
      ['p1', contexto({ patientId: 'p1' })],
      ['p2', contexto({ patientId: 'p2' })],
    ]),
  );
  const resumo = summarizeCoordination(decisoes);
  assert.equal(resumo.granted, 2);
  assert.equal(resumo.deferred, 2);
  assert.equal(resumo.yields.length, 1, 'a mesma cedência duas vezes é uma linha com contagem 2');
  assert.equal(resumo.yields[0].count, 2);
});

// ─── Ligação ao catálogo ────────────────────────────────────────────────────

test('todos os agentes que pedem contactos existem no catálogo', () => {
  const ids = new Set(AGENTS.map((a) => a.id));
  for (const agentId of ['patient', 'scheduling', 'lead']) {
    assert.ok(ids.has(agentId as never), `${agentId} devia estar em lib/agents/registry.ts`);
  }
});
