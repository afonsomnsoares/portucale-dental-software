// O degrau 'agenda' (migração 062): o software a escrever mesmo na agenda.
//
// Integração porque é aqui que está o risco. Um teste puro mostra que a DECISÃO é a
// certa; só a base de dados mostra que a consulta desaparece, que o cancelamento fica
// registado onde o risco de falta e a previsão o vão ler, que a vaga chega à lista de
// espera, e — o mais importante — que nada disto acontece quando o degrau está desligado.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cancelForPatient, findOfferableSlot, offerSlotToPatient, persistOffer } from '../../lib/agents/schedulingAutonomy.ts';
import { query, queryOne } from '../../lib/db.ts';
import { handleInbound } from '../../lib/inbound.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
let dentistId: string;
const RUN = crypto.randomUUID();
const PREFIXO = 'Autonomia';
// handleInbound recebe a mensagem já resolvida para uma clínica (o webhook faz isso antes),
// por isso o destino é só o número da linha e não é usado para encaminhar nada.
const CLINICA = '+351900555777';
let seq = 0;

async function setAutonomy(nivel: string) {
  await query(
    `INSERT INTO tenant_comms_settings (tenant_id, autonomy_level) VALUES ($1,$2)
     ON CONFLICT (tenant_id) DO UPDATE SET autonomy_level=EXCLUDED.autonomy_level`,
    [tenantAId, nivel],
  );
}

async function ownDentist() {
  const [u] = await query(
    `INSERT INTO users (tenant_id, email, password, name, role, active)
     VALUES ($1,'autonomia.testes@portucale.local','x','Dentista (autonomia)','dentist',TRUE)
     ON CONFLICT (email) DO UPDATE SET active=TRUE RETURNING id`,
    [tenantAId],
  );
  const id = String(u.id);
  await query(`DELETE FROM staff_schedules WHERE user_id=$1`, [id]);
  for (let weekday = 0; weekday <= 6; weekday++) {
    await query(
      `INSERT INTO staff_schedules (tenant_id, user_id, weekday, start_time, end_time) VALUES ($1,$2,$3,'08:00','20:00')`,
      [tenantAId, id, weekday],
    );
  }
  return id;
}

async function limpar() {
  const alvo = `SELECT id FROM patients WHERE tenant_id=$1 AND name LIKE '${PREFIXO} %'`;
  await query(`DELETE FROM slot_offers WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id=$1 AND patient_id IN (${alvo}))`, [tenantAId]);
  await query(`DELETE FROM conversations WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM appointment_cancellations WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM patient_timeline WHERE patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM appointments WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM patient_tasks WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM patients WHERE tenant_id=$1 AND name LIKE '${PREFIXO} %'`, [tenantAId]);
}

async function doente() {
  seq += 1;
  const phone = `91${String(seq).padStart(3, '0')}${RUN.replace(/\D/g, '').slice(0, 4).padEnd(4, '0')}`.slice(0, 9);
  const [row] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id, phone`,
    [tenantAId, `${PREFIXO} ${seq} (${RUN.slice(0, 8)})`, phone],
  );
  return { id: String(row.id), phone: String(row.phone) };
}

async function marcar(patientId: string, diasAdiante = 9) {
  const [row] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, dentist_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,$3,2,(CURRENT_DATE + ($4::int * INTERVAL '1 day'))::date,'14:00',45,'Destartarização','confirmed')
     RETURNING id`,
    [tenantAId, patientId, dentistId, diasAdiante],
  );
  return String(row.id);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  await limpar();
  dentistId = await ownDentist();
});

beforeEach(() => setAutonomy('agenda'));

after(async () => {
  await limpar();
  // Repor o valor de repouso: o degrau que escreve não pode ficar ligado por um teste.
  await setAutonomy('off');
  await closeTestDb();
});

// ─── Cancelar ───────────────────────────────────────────────────────────────

test('cancelar tira a consulta da agenda e deixa o registo onde os outros o leem', async () => {
  const p = await doente();
  const apt = await marcar(p.id);

  const r = await cancelForPatient(tenantAId, p.id, 'teste');
  assert.ok(r);
  assert.equal(r.cancelled.id, apt);

  assert.equal(await queryOne(`SELECT id FROM appointments WHERE id=$1`, [apt]), null);
  // appointment_cancellations é o que alimenta o risco de falta, a previsão e o ecrã de
  // cancelamentos. Um cancelamento por SMS não pode ser invisível a tudo isso.
  const cancelamento = await queryOne(`SELECT * FROM appointment_cancellations WHERE appointment_id=$1`, [apt]);
  assert.ok(cancelamento, 'devia ter ficado registado');

  // E fica na timeline, identificado como automático.
  const linha = await queryOne(
    `SELECT event, user_name FROM patient_timeline WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [p.id],
  );
  assert.match(String(linha?.event), /cancelada automaticamente/);
  assert.match(String(linha?.user_name), /automático/);
});

// A regra da ambiguidade, imposta uma segunda vez no momento da escrita: entre a leitura
// que decidiu e esta há espaço para uma marcação feita ao balcão.
test('com duas consultas marcadas não cancela nenhuma', async () => {
  const p = await doente();
  await marcar(p.id, 9);
  await marcar(p.id, 16);

  assert.equal(await cancelForPatient(tenantAId, p.id, 'teste'), null);
  const restantes = await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id]);
  assert.equal(restantes.length, 2, 'não devia ter mexido em nenhuma');
});

// ─── Oferecer e aceitar ─────────────────────────────────────────────────────

test('oferecer um lugar não marca nada — só marca quem aceita', async () => {
  const p = await doente();

  const oferta = await offerSlotToPatient(tenantAId, p.id, { origin: 'inbound', type: 'Destartarização' });
  assert.ok(oferta, 'devia ter encontrado um lugar');
  assert.match(oferta.body, /Responda SIM/);

  // Nada na agenda ainda. É a diferença entre propor e marcar.
  const marcadas = await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id]);
  assert.equal(marcadas.length, 0);

  const guardada = await queryOne(`SELECT origin, status, offered_type FROM slot_offers WHERE id=$1`, [oferta.offerId]);
  assert.equal(String(guardada?.origin), 'inbound');
  assert.equal(String(guardada?.status), 'sent');
  assert.equal(String(guardada?.offered_type), 'Destartarização');
});

// O índice único da migração 062: três «quero marcar» não podem virar três consultas
// aceites por um SIM que o doente acha que foi um só.
test('um doente só tem uma oferta pendente de cada vez', async () => {
  const p = await doente();
  assert.ok(await offerSlotToPatient(tenantAId, p.id, { origin: 'inbound' }));
  assert.equal(await offerSlotToPatient(tenantAId, p.id, { origin: 'inbound' }), null);

  const pendentes = await query(`SELECT id FROM slot_offers WHERE patient_id=$1 AND status='sent'`, [p.id]);
  assert.equal(pendentes.length, 1);
});

test('quem recusou contacto automático não recebe ofertas', async () => {
  const p = await doente();
  await query(`UPDATE patients SET comm_prefs='{"doNotContact":["sms"]}'::jsonb WHERE id=$1`, [p.id]);
  assert.equal(await findOfferableSlot(tenantAId, p.id, 'Destartarização'), null);
});

// ─── O caminho inteiro, pelo webhook ────────────────────────────────────────

test('um SMS a cancelar cancela mesmo, e o degrau abaixo não', async () => {
  // Degrau que escreve.
  const p = await doente();
  const apt = await marcar(p.id);
  const r = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'não vou poder ir, cancelem por favor',
    providerId: `auto-cancel-${RUN}`,
  });
  assert.equal(r.action, 'cancel_appointment');
  assert.equal(await queryOne(`SELECT id FROM appointments WHERE id=$1`, [apt]), null);

  // Mesmo texto, degrau abaixo: a consulta fica.
  await setAutonomy('transactional');
  const p2 = await doente();
  const apt2 = await marcar(p2.id);
  const r2 = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p2.phone,
    body: 'não vou poder ir, cancelem por favor',
    providerId: `auto-cancel-off-${RUN}`,
  });
  assert.notEqual(r2.action, 'cancel_appointment');
  assert.ok(await queryOne(`SELECT id FROM appointments WHERE id=$1`, [apt2]), 'não devia ter mexido na agenda');
});

test('marcar por SMS: pedir, receber a proposta, dizer SIM e ficar com a consulta', async () => {
  const p = await doente();

  const pedido = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'queria marcar uma consulta',
    providerId: `auto-book-${RUN}`,
  });
  assert.equal(pedido.action, 'offer_slot');

  const oferta = await queryOne(`SELECT * FROM slot_offers WHERE patient_id=$1 AND status='sent'`, [p.id]);
  assert.ok(oferta, 'devia haver uma oferta pendente');
  assert.equal(await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id]).then((r) => r.length), 0);

  const sim = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'sim',
    providerId: `auto-yes-${RUN}`,
  });
  assert.equal(sim.action, 'accept_offer');

  const marcadas = await query(`SELECT appt_date::text AS d, start_time::text AS t, notes FROM appointments WHERE patient_id=$1`, [p.id]);
  assert.equal(marcadas.length, 1, 'o SIM devia ter marcado a consulta');
  assert.equal(String(marcadas[0].d), String(oferta.offered_date).slice(0, 10));
  assert.match(String(marcadas[0].notes), /SMS/);

  const depois = await queryOne(`SELECT status FROM slot_offers WHERE id=$1`, [oferta.id]);
  assert.equal(String(depois?.status), 'accepted');
});

// Aceitar uma oferta cujo lugar foi entretanto ocupado não pode marcar por cima.
test('um SIM sobre um lugar já ocupado não duplica a consulta', async () => {
  const p = await doente();
  const slot = await findOfferableSlot(tenantAId, p.id, 'Destartarização');
  assert.ok(slot);
  await persistOffer(tenantAId, p.id, slot, { origin: 'inbound' });

  // Alguém marca ao balcão exatamente naquele lugar.
  const outro = await doente();
  await query(
    `INSERT INTO appointments (tenant_id, patient_id, dentist_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,$3,$4,$5::date,$6::time,$7,'Destartarização','confirmed')`,
    [tenantAId, outro.id, slot.dentistId, slot.chair, slot.date, slot.startTime, slot.duration],
  );

  const sim = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'sim',
    providerId: `auto-yes-taken-${RUN}`,
  });
  assert.equal(sim.action, 'accept_offer');

  const minhas = await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id]);
  assert.equal(minhas.length, 0, 'não podia ter marcado por cima');
  const oferta = await queryOne(`SELECT status FROM slot_offers WHERE patient_id=$1`, [p.id]);
  assert.equal(String(oferta?.status), 'expired');
});

// ─── Remarcar é mover, não acrescentar ──────────────────────────────────────
// A oferta de remarcação não sabia que consulta substituía, e o SIM fazia um INSERT como
// qualquer outra aceitação: o doente ficava com a consulta nova E a antiga. E o lugar
// proposto era de uma «Consulta de Avaliação» genérica, não do tratamento que ele tinha.
test('remarcar por SMS move a consulta que existia, em vez de criar uma segunda', async () => {
  const p = await doente();
  const original = await marcar(p.id, 9);

  const pedido = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'preciso de remarcar a minha consulta',
    providerId: `auto-resched-${RUN}`,
  });
  assert.equal(pedido.action, 'offer_slot');

  const oferta = await queryOne(`SELECT * FROM slot_offers WHERE patient_id=$1 AND status='sent'`, [p.id]);
  assert.ok(oferta, 'devia haver uma oferta pendente');
  assert.equal(String(oferta.replaces_appointment_id), original, 'a oferta não sabe que consulta substitui');
  assert.equal(String(oferta.offered_type), 'Destartarização', 'ofereceu outro tratamento');
  assert.equal(Number(oferta.offered_duration), 45, 'ofereceu outra duração');

  const sim = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'sim',
    providerId: `auto-resched-yes-${RUN}`,
  });
  assert.equal(sim.action, 'accept_offer');

  const minhas = await query(
    `SELECT id, appt_date::text AS d, start_time::text AS t, rescheduled_at FROM appointments WHERE patient_id=$1`,
    [p.id],
  );
  assert.equal(minhas.length, 1, 'o doente ficou com duas consultas');
  assert.equal(String(minhas[0].id), original, 'devia ter movido a original, não criado outra');
  assert.equal(String(minhas[0].d), String(oferta.offered_date).slice(0, 10));
  assert.equal(String(minhas[0].t).slice(0, 5), String(oferta.offered_start_time).slice(0, 5));
  // É o rescheduled_at que faz a tarefa 'confirmations' confirmar a data nova.
  assert.ok(minhas[0].rescheduled_at, 'sem rescheduled_at o doente não recebe a confirmação da data nova');

  const linha = await queryOne(
    `SELECT event, user_name FROM patient_timeline WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [p.id],
  );
  assert.match(String(linha?.event), /remarcada automaticamente/);
  assert.match(String(linha?.user_name), /automático/);
});

// ─── SIM a uma oferta da lista de espera ────────────────────────────────────
// A oferta da lista de espera era invisível ao SIM (pendingOfferFor excluía-a), que caía na
// resposta de confirmação: «a sua consulta fica confirmada», sem nada marcado.
async function ofertaDaLista(patientId: string) {
  const { addToWaitlist } = await import('../../lib/waitlist.ts');
  const entrada = await addToWaitlist(tenantAId, null, { patientId, treatmentType: 'Destartarização' });
  const slot = await findOfferableSlot(tenantAId, patientId, 'Destartarização');
  assert.ok(slot, 'devia haver um lugar livre para o teste');
  const [o] = await query(
    `INSERT INTO slot_offers (tenant_id, waitlist_entry_id, patient_id, offered_date, offered_start_time,
                              offered_duration, offered_chair, offered_dentist_id, origin, offered_type)
     VALUES ($1,$2,$3,$4::date,$5::time,$6,$7,$8,'waitlist','Destartarização') RETURNING id`,
    [tenantAId, entrada.id, patientId, slot.date, slot.startTime, slot.duration, slot.chair, slot.dentistId],
  );
  await query(`UPDATE waitlist_entries SET status='offered' WHERE id=$1`, [entrada.id]);
  return { offerId: String(o.id), entryId: String(entrada.id) };
}

test('SIM a uma oferta da lista de espera marca a consulta no degrau agenda', async () => {
  const p = await doente();
  const { offerId, entryId } = await ofertaDaLista(p.id);

  const sim = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'sim',
    providerId: `wl-yes-${RUN}`,
  });
  assert.equal(sim.action, 'accept_offer');
  assert.equal((await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id])).length, 1);
  assert.equal(String((await queryOne(`SELECT status FROM slot_offers WHERE id=$1`, [offerId]))?.status), 'accepted');
  assert.equal(String((await queryOne(`SELECT status FROM waitlist_entries WHERE id=$1`, [entryId]))?.status), 'fulfilled');
  await query(`DELETE FROM waitlist_entries WHERE id=$1`, [entryId]);
});

test('abaixo do degrau agenda, o SIM à lista de espera não finge que marcou', async () => {
  await setAutonomy('transactional');
  const p = await doente();
  const { offerId, entryId } = await ofertaDaLista(p.id);

  const sim = await handleInbound(tenantAId, {
    channel: 'sms',
    toAddress: CLINICA,
    fromAddress: p.phone,
    body: 'sim',
    providerId: `wl-yes-low-${RUN}`,
  });
  assert.equal(sim.action, 'auto_acknowledge');
  assert.equal((await query(`SELECT id FROM appointments WHERE patient_id=$1`, [p.id])).length, 0);
  assert.equal(String((await queryOne(`SELECT status FROM slot_offers WHERE id=$1`, [offerId]))?.status), 'sent');

  const enviada = await queryOne(
    `SELECT m.body FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.patient_id=$1 AND m.direction='outbound' ORDER BY m.created_at DESC LIMIT 1`,
    [p.id],
  );
  assert.doesNotMatch(String(enviada?.body ?? ''), /fica confirmada/, 'disse ao doente que estava marcado');
  await query(`DELETE FROM slot_offers WHERE id=$1`, [offerId]);
  await query(`DELETE FROM waitlist_entries WHERE id=$1`, [entryId]);
});
