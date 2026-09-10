import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampLeadTriage, type LeadContact } from '../lib/agents/leadAgentCalc.ts';

const CANDIDATES: ReadonlyMap<string, LeadContact> = new Map([
  ['lead-1', { hasPhone: true, hasEmail: false }],
  ['lead-2', { hasPhone: false, hasEmail: true }],
  ['lead-3', { hasPhone: true, hasEmail: true }],
]);

test('clampLeadTriage: aceita uma qualificação válida com rascunho', () => {
  const out = clampLeadTriage(CANDIDATES, [
    { leadId: 'lead-1', qualification: 'hot', intent: 'quer marcar', draftReply: 'Obrigado pelo contacto!' },
  ]);
  assert.deepEqual(out, [
    { leadId: 'lead-1', qualification: 'hot', intent: 'quer marcar', draftChannel: 'sms', draftReply: 'Obrigado pelo contacto!' },
  ]);
});

// Com o agente reduzido a chamada e SMS (migração 052), um lead sem telefone não tem por
// onde ser respondido. O ramo do e-mail existia e nunca chegou a enviar nada — a rota de
// envio devolvia 'email_not_supported' desde sempre — por isso escrever-lhe um rascunho
// era produzir trabalho que ninguém podia expedir.
test('clampLeadTriage: um lead sem telefone não recebe rascunho', () => {
  const out = clampLeadTriage(CANDIDATES, [{ leadId: 'lead-2', qualification: 'warm', draftReply: 'Olá!' }]);
  assert.deepEqual(out, [], 'lead-2 só tem email — fica para contacto manual');
});

test('clampLeadTriage: o canal é sempre SMS, nunca escolhido pela IA', () => {
  const out = clampLeadTriage(CANDIDATES, [{ leadId: 'lead-3', qualification: 'cold', draftReply: 'Olá!' }]);
  assert.equal(out[0].draftChannel, 'sms');
});

test('clampLeadTriage: ignora um leadId fora do espaço de candidatos', () => {
  const out = clampLeadTriage(CANDIDATES, [{ leadId: 'lead-inventado', qualification: 'hot', draftReply: 'Olá!' }]);
  assert.deepEqual(out, []);
});

test('clampLeadTriage: qualificação fora do enum é rejeitada', () => {
  const out = clampLeadTriage(CANDIDATES, [{ leadId: 'lead-1', qualification: 'urgente', draftReply: 'Olá!' }]);
  assert.deepEqual(out, []);
});

test('clampLeadTriage: sem rascunho de resposta é rejeitado (o valor do agente é o texto)', () => {
  const out = clampLeadTriage(CANDIDATES, [{ leadId: 'lead-1', qualification: 'hot', draftReply: '' }]);
  assert.deepEqual(out, []);
});

test('clampLeadTriage: um leadId duplicado só conta uma vez', () => {
  const out = clampLeadTriage(CANDIDATES, [
    { leadId: 'lead-1', qualification: 'hot', draftReply: 'Primeira' },
    { leadId: 'lead-1', qualification: 'cold', draftReply: 'Segunda' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].draftReply, 'Primeira');
});

test('clampLeadTriage: intent e draftReply são cortados a 300/600 caracteres', () => {
  const out = clampLeadTriage(CANDIDATES, [
    { leadId: 'lead-1', qualification: 'hot', intent: 'x'.repeat(500), draftReply: 'y'.repeat(1000) },
  ]);
  assert.equal(out[0].intent.length, 300);
  assert.equal(out[0].draftReply.length, 600);
});

test('clampLeadTriage: lista vazia ou nula devolve lista vazia', () => {
  assert.deepEqual(clampLeadTriage(CANDIDATES, []), []);
  assert.deepEqual(clampLeadTriage(CANDIDATES, null), []);
});
