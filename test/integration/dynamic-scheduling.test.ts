// Integration test do Dynamic Scheduling — lib/dynamicScheduling.ts,
// lib/demandPool.ts, lib/slotOffers.ts e lib/smsInbound.ts contra a BD de
// testes. Corre com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// O que se testa aqui é o que os testes puros não podem testar: que as consultas
// SQL encontram mesmo a procura onde ela está, que uma oferta aceite vira
// consulta (e não vira duas), e que uma resposta por SMS faz o que deve fazer —
// incluindo o caso que interessa mais, que é NÃO marcar quando não deve.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { buildDemandPool } from '../../lib/demandPool.ts';
import { computeDynamicPlan } from '../../lib/dynamicScheduling.ts';
import { getSchedulingPolicy, saveSchedulingPolicy } from '../../lib/schedulingPolicy.ts';
import { acceptOfferAndBook, createOffer, getOffer } from '../../lib/slotOffers.ts';
import { processInboundSms } from '../../lib/smsInbound.ts';
import type { TestUser } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getSeededDentistId,
  getSeededPatientId,
  getSeededUser,
  getTenantAId,
} from '../helpers/testDb.ts';

let superAdmin: TestUser;
let tenantAId: string;
let patientAId: string;
let dentistAId: string;
const createdShiftIds: string[] = [];
const createdOfferIds: string[] = [];
const createdApptIds: string[] = [];

// Datas fixas bem no futuro, para não colidirem com nada semeado nem com outra
// corrida deste ficheiro (que limpa o que cria, mas nunca convém depender disso).
const FUTURE_DATE = '2027-03-15'; // segunda-feira
const FUTURE_TIME = '11:00';

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

before(async () => {
  await ensureSeeded();
  superAdmin = await getSeededUser('admin@portucale.dental');
  tenantAId = await getTenantAId();
  patientAId = await getSeededPatientId(tenantAId);
  dentistAId = await getSeededDentistId(tenantAId);

  // Turnos: sem eles não há dentista disponível para espaço nenhum, e o motor
  // (corretamente) não propõe nada — ver o aviso em lib/dynamicScheduling.ts.
  for (const weekday of [1, 2, 3, 4, 5]) {
    const existing = await query(
      `SELECT id FROM staff_schedules WHERE tenant_id=$1 AND user_id=$2 AND weekday=$3`,
      [tenantAId, dentistAId, weekday],
    );
    if (existing.length) continue;
    const [row] = await query(
      `INSERT INTO staff_schedules (tenant_id, user_id, weekday, start_time, end_time)
       VALUES ($1,$2,$3,'09:00','18:00') RETURNING id`,
      [tenantAId, dentistAId, weekday],
    );
    createdShiftIds.push(String(row.id));
  }
});

after(async () => {
  if (createdOfferIds.length) {
    await query(`DELETE FROM slot_offers WHERE id = ANY($1::uuid[])`, [createdOfferIds]);
  }
  if (createdApptIds.length) {
    await query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [createdApptIds]);
  }
  if (createdShiftIds.length) {
    await query(`DELETE FROM staff_schedules WHERE id = ANY($1::uuid[])`, [createdShiftIds]);
  }
  await closeTestDb();
});

// ─── Política ──────────────────────────────────────────────────────────────

test('uma clínica sem política configurada não contacta ninguém', async () => {
  const policy = await getSchedulingPolicy(tenantAId);
  assert.equal(policy.mode, 'propose');
});

test('a política grava e limita os valores fora do intervalo', async () => {
  const saved = await saveSchedulingPolicy(tenantAId, superAdmin as never, {
    mode: 'propose',
    maxOffersPerSlot: 99,
    minScore: 10,
    horizonDays: 21,
  });
  assert.equal(saved.maxOffersPerSlot, 10);
  assert.equal(saved.minScore, 10);
  assert.equal(saved.horizonDays, 21);
  const reread = await getSchedulingPolicy(tenantAId);
  assert.equal(reread.horizonDays, 21);
});

// ─── Procura ───────────────────────────────────────────────────────────────

test('a procura sai da base toda, não só da lista de espera', async () => {
  const pool = await buildDemandPool(tenantAId, {
    horizonDays: 30,
    sources: ['waitlist', 'treatment_open', 'recall_due', 'advance', 'reactivation'],
  });
  // Os dados semeados têm recalls vencidos — é a fonte que este produto tinha
  // por explorar e a que garante que a consulta SQL encontra mesmo alguém.
  assert.ok(pool.counts.recall_due > 0, 'esperava candidatos vindos de recalls vencidos');
  for (const c of pool.candidates) {
    assert.ok(c.patientName, 'candidato sem nome');
    assert.ok(c.durationMinutes > 0, 'candidato sem duração');
    assert.ok(c.treatmentType, 'candidato sem tipo de consulta');
  }
});

test('o plano encaixa candidatos em espaços livres com dentista atribuído', async () => {
  const plan = await computeDynamicPlan(tenantAId);
  assert.ok(plan.totals.openings > 0, 'esperava espaços livres na agenda semeada');
  assert.ok(plan.slots.length > 0, 'esperava pelo menos um encaixe proposto');

  const [slot] = plan.slots;
  assert.ok(slot.offers.length > 0);
  for (const offer of slot.offers) {
    assert.ok(offer.score >= 0 && offer.score <= 100);
    assert.ok(offer.reason.length > 0, 'toda a oferta tem de dizer porque foi escolhida');
    assert.ok(offer.dentistName, 'não se oferece uma vaga sem saber quem a atende');
  }
  // Nunca hoje de manhã quando já é de tarde (ver effectiveOpeningStart).
  assert.ok(slot.date >= new Date().toISOString().slice(0, 10));
});

test('o mesmo doente nunca aparece em dois espaços do mesmo plano', async () => {
  const plan = await computeDynamicPlan(tenantAId);
  const keys = plan.slots.flatMap((s) => s.offers.map((o) => o.candidateKey));
  assert.equal(keys.length, new Set(keys).size, 'um doente foi proposto para mais do que um espaço');
});

// ─── Ofertas ───────────────────────────────────────────────────────────────

async function makeOffer(overrides: Partial<Parameters<typeof createOffer>[1]> = {}) {
  const offer = await createOffer(tenantAId, {
    source: 'recall_due',
    patientId: patientAId,
    phone: '',
    date: FUTURE_DATE,
    startTime: FUTURE_TIME,
    duration: 30,
    chair: 1,
    dentistId: dentistAId,
    type: 'Consulta de Avaliação',
    expiresAt: new Date(Date.now() + 3600_000),
    autoBook: false,
    messageBody: 'teste',
    ...overrides,
  });
  if (offer) createdOfferIds.push(String(offer.id));
  return offer;
}

test('aceitar uma oferta cria a consulta e fecha a oferta', async () => {
  const offer = await makeOffer();
  assert.ok(offer);
  const result = await acceptOfferAndBook(tenantAId, String(offer.id));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdApptIds.push(String(result.result.appointment.id));

  assert.equal(String(result.result.appointment.patient_id), patientAId);
  // `appt_date` volta do driver como Date, não como texto — a mesma armadilha
  // que offerSlotTimes existe para tapar em lib/slotOffers.ts.
  assert.equal(new Date(String(result.result.appointment.appt_date)).toLocaleDateString('en-CA'), FUTURE_DATE);
  const reread = await getOffer(tenantAId, String(offer.id));
  assert.equal(reread?.status, 'accepted');
  assert.equal(String(reread?.appointment_id), String(result.result.appointment.id));
});

test('a mesma oferta não pode ser aceite duas vezes', async () => {
  const offer = await makeOffer({ startTime: '15:00' });
  assert.ok(offer);
  const first = await acceptOfferAndBook(tenantAId, String(offer.id));
  assert.equal(first.ok, true);
  if (first.ok) createdApptIds.push(String(first.result.appointment.id));

  const second = await acceptOfferAndBook(tenantAId, String(offer.id));
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error, 'not_pending');
});

// A razão de ser da verificação de conflito dentro da transação: entre a oferta
// sair e o doente responder passam horas, e a receção pode ter marcado ali
// entretanto. Uma pessoa via o choque no ecrã; um webhook não vê nada.
test('uma oferta cujo horário foi entretanto ocupado é recusada', async () => {
  const offer = await makeOffer({ startTime: '16:00' });
  assert.ok(offer);
  const [clash] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,'Ocupante',$3,1,$4::date,'16:00',30,'Consulta','confirmed') RETURNING id`,
    [tenantAId, patientAId, dentistAId, FUTURE_DATE],
  );
  createdApptIds.push(String(clash.id));

  const result = await acceptOfferAndBook(tenantAId, String(offer.id));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'slot_taken');
});

test('uma oferta caducada não marca nada', async () => {
  const offer = await makeOffer({ startTime: '17:00', expiresAt: new Date(Date.now() - 3600_000) });
  assert.ok(offer);
  const result = await acceptOfferAndBook(tenantAId, String(offer.id));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'expired');
});

// ─── Respostas por SMS ─────────────────────────────────────────────────────

async function patientPhone() {
  const [row] = await query(`SELECT phone FROM patients WHERE id=$1`, [patientAId]);
  return String(row?.phone || '');
}

test('um "NÃO" recusa a oferta e não marca nada', async () => {
  const offer = await makeOffer({ startTime: '09:30' });
  assert.ok(offer);
  const result = await processInboundSms({
    from: await patientPhone(),
    body: 'Não, obrigado',
    providerId: `SMtest-decline-${Date.now()}`,
  });
  assert.equal(result.status, 'handled');
  assert.equal(result.intent, 'decline');
  const reread = await getOffer(tenantAId, String(offer.id));
  assert.equal(reread?.status, 'declined');
});

// A fronteira que separa 'contact' de 'autobook': com auto_book a false, um SIM
// NÃO marca — deixa uma tarefa para quem atende.
test('um "SIM" a uma oferta sem autorização de marcação automática não marca', async () => {
  const offer = await makeOffer({ startTime: '10:00', autoBook: false });
  assert.ok(offer);
  const result = await processInboundSms({
    from: await patientPhone(),
    body: 'SIM',
    providerId: `SMtest-accept-manual-${Date.now()}`,
  });
  assert.equal(result.booked, false);
  const reread = await getOffer(tenantAId, String(offer.id));
  assert.equal(reread?.status, 'sent', 'a oferta tem de continuar pendente até uma pessoa a confirmar');

  const tasks = await query(
    `SELECT id FROM patient_tasks WHERE tenant_id=$1 AND patient_id=$2 AND status='pending' AND title ILIKE '%Confirmar vaga aceite%'`,
    [tenantAId, patientAId],
  );
  assert.ok(tasks.length > 0, 'esperava uma tarefa para a receção confirmar');
  await query(`DELETE FROM patient_tasks WHERE id = ANY($1::uuid[])`, [tasks.map((t) => t.id)]);
});

test('um "SIM" a uma oferta com marcação automática marca mesmo', async () => {
  const offer = await makeOffer({ startTime: '12:00', autoBook: true });
  assert.ok(offer);
  const result = await processInboundSms({
    from: await patientPhone(),
    body: 'sim',
    providerId: `SMtest-accept-auto-${Date.now()}`,
  });
  assert.equal(result.booked, true);
  const reread = await getOffer(tenantAId, String(offer.id));
  assert.equal(reread?.status, 'accepted');
  if (reread?.appointment_id) createdApptIds.push(String(reread.appointment_id));
});

test('uma resposta ambígua não marca nem recusa — vai para uma pessoa', async () => {
  const offer = await makeOffer({ startTime: '13:00', autoBook: true });
  assert.ok(offer);
  const result = await processInboundSms({
    from: await patientPhone(),
    body: 'sim mas só depois das 18',
    providerId: `SMtest-unknown-${Date.now()}`,
  });
  assert.equal(result.intent, 'unknown');
  assert.equal(result.booked, false);
  const reread = await getOffer(tenantAId, String(offer.id));
  assert.equal(reread?.status, 'sent');

  const tasks = await query(
    `SELECT id FROM patient_tasks WHERE tenant_id=$1 AND patient_id=$2 AND status='pending' AND title ILIKE '%Ler resposta%'`,
    [tenantAId, patientAId],
  );
  assert.ok(tasks.length > 0);
  await query(`DELETE FROM patient_tasks WHERE id = ANY($1::uuid[])`, [tasks.map((t) => t.id)]);
});

// O Twilio reentrega o mesmo webhook quando não recebe 200 a tempo. Sem
// idempotência, um timeout de rede marcava a mesma consulta duas vezes.
test('a mesma mensagem entregue duas vezes só é processada uma', async () => {
  const offer = await makeOffer({ startTime: '14:00', autoBook: true });
  assert.ok(offer);
  const providerId = `SMtest-dup-${Date.now()}`;
  const from = await patientPhone();

  const first = await processInboundSms({ from, body: 'SIM', providerId });
  assert.equal(first.status, 'handled');
  assert.equal(first.booked, true);
  const reread = await getOffer(tenantAId, String(offer.id));
  if (reread?.appointment_id) createdApptIds.push(String(reread.appointment_id));

  const second = await processInboundSms({ from, body: 'SIM', providerId });
  assert.equal(second.status, 'duplicate');
  assert.equal(second.booked, false);

  const appts = await query(
    `SELECT id FROM appointments WHERE tenant_id=$1 AND appt_date=$2::date AND start_time='14:00'`,
    [tenantAId, FUTURE_DATE],
  );
  assert.equal(appts.length, 1, 'a reentrega criou uma segunda consulta');
});

test('um número desconhecido é registado, não descartado', async () => {
  const result = await processInboundSms({
    from: '+351900000000',
    body: 'SIM',
    providerId: `SMtest-unknown-number-${Date.now()}`,
  });
  assert.equal(result.status, 'unknown_number');
  assert.equal(result.tenantId, null);
});

test('a agenda de amanhã continua a ser oferecível depois de tudo isto', async () => {
  // Rede de segurança contra os testes acima deixarem a clínica num estado
  // esquisito: o plano tem de continuar a calcular sem rebentar.
  const plan = await computeDynamicPlan(tenantAId);
  assert.ok(plan.generatedAt);
  assert.ok(plan.totals.openings >= 0);
  assert.ok(tomorrowIso() > new Date().toISOString().slice(0, 10));
});
