import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSms, parseSmsReply } from '../lib/smsReplyCalc.ts';
import { computeTwilioSignature, verifyTwilioSignature } from '../lib/twilioSignature.ts';

test('normalizeSms strips accents, case and punctuation', () => {
  assert.equal(normalizeSms('  SIM, confirmação!! '), 'sim confirmacao');
});

test('parseSmsReply reads the plain confirmations', () => {
  for (const body of ['Sim', 'SIM', 's', 'ok', 'Confirmo', 'sim, pode ser', 'Aceito obrigado']) {
    assert.equal(parseSmsReply(body), 'accept', body);
  }
});

test('parseSmsReply reads refusals, accents or not', () => {
  for (const body of ['Não', 'nao', 'N', 'não posso', 'nao consigo nesse horario', 'outro dia']) {
    assert.equal(parseSmsReply(body), 'decline', body);
  }
});

// A armadilha que motiva a ordem das listas em lib/smsReplyCalc.ts: "não quero"
// contém "quero", e ler isto como aceitação marcaria uma consulta recusada.
test('parseSmsReply does not read a negated verb as acceptance', () => {
  assert.equal(parseSmsReply('não quero'), 'decline');
  assert.equal(parseSmsReply('nao posso ir'), 'decline');
});

test('parseSmsReply refuses to guess when the message says both things', () => {
  assert.equal(parseSmsReply('sim mas não antes das 18'), 'unknown');
});

// Sem negação nenhuma, e ainda assim não é um sim: a pessoa aceitou OUTRA coisa.
// Era o caso que escapava — "sim mas só depois das 18" marcava as 11:00.
test('parseSmsReply does not treat a conditional yes as a yes', () => {
  for (const body of [
    'sim mas só depois das 18',
    'ok, apenas com a Dra. Costa',
    'pode ser? a que horas',
    'sim, prefiro outra hora',
    'ok desde que seja de manhã',
  ]) {
    assert.equal(parseSmsReply(body), 'unknown', body);
  }
});

test('parseSmsReply still reads a plain yes as a yes', () => {
  for (const body of ['Sim', 'sim, pode ser', 'Confirmo, obrigado', 'ok']) {
    assert.equal(parseSmsReply(body), 'accept', body);
  }
});

test('parseSmsReply sends anything it cannot read to a human', () => {
  for (const body of ['', '   ', 'depois das 6?', 'quem fala?', '👍']) {
    assert.equal(parseSmsReply(body), 'unknown', JSON.stringify(body));
  }
});

test('parseSmsReply honours opt-out above everything else', () => {
  for (const body of ['STOP', 'parar', 'não me mandem mais mensagens', 'unsubscribe']) {
    assert.equal(parseSmsReply(body), 'stop', body);
  }
});

test('verifyTwilioSignature accepts a correctly signed request', () => {
  const url = 'https://clinica.pt/api/webhooks/sms';
  const params = { From: '+351911111111', Body: 'SIM', MessageSid: 'SM123' };
  const sig = computeTwilioSignature('token-secreto', url, params);
  assert.equal(verifyTwilioSignature('token-secreto', url, params, sig), true);
});

test('verifyTwilioSignature rejects a tampered body, a wrong token and a missing signature', () => {
  const url = 'https://clinica.pt/api/webhooks/sms';
  const params = { From: '+351911111111', Body: 'SIM', MessageSid: 'SM123' };
  const sig = computeTwilioSignature('token-secreto', url, params);
  assert.equal(verifyTwilioSignature('token-secreto', url, { ...params, Body: 'NAO' }, sig), false);
  assert.equal(verifyTwilioSignature('outro-token', url, params, sig), false);
  assert.equal(verifyTwilioSignature('token-secreto', url, params, null), false);
  assert.equal(verifyTwilioSignature('', url, params, sig), false);
});

test('computeTwilioSignature is order-independent on the parameters', () => {
  const url = 'https://clinica.pt/api/webhooks/sms';
  const a = computeTwilioSignature('t', url, { B: '2', A: '1' });
  const b = computeTwilioSignature('t', url, { A: '1', B: '2' });
  assert.equal(a, b);
});
