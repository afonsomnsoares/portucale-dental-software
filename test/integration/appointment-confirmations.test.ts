// A confirmação que sai a seguir a marcar (lib/jobsRunner.ts:queueAppointmentConfirmations).
//
// Porque é que isto é um teste de integração e não puro: o valor da tarefa não está no
// texto da mensagem — está em QUEM a deixa sair. A confirmação atravessa a varredura por
// `created_at`, a guarda contra mensagens já enviadas para a mesma consulta, o
// consentimento (lib/commPrefs.ts) e o árbitro (lib/agents/coordination.ts), e só depois
// aparece em `notifications`. Cada uma dessas camadas tem a sua própria razão para não
// deixar sair nada, e um teste que não passe pela base de dados não distingue "não saiu
// porque está certo" de "não saiu porque se partiu".
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { query, queryOne } from '../../lib/db.ts';
import { runJob } from '../../lib/jobsRunner.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
const RUN = crypto.randomUUID();

// Mesmo raciocínio do ficheiro de coordenação: um doente próprio, com telefone único,
// em vez de pescar um da semente. O opt-out de outro teste silencia todos os que
// partilham o número, e a semente repete telefones por dezenas de fichas.
let patientSeq = 0;
async function doenteContactavel(over: { commPrefs?: string } = {}) {
  patientSeq += 1;
  const phone = `95${String(patientSeq).padStart(3, '0')}${RUN.replace(/\D/g, '').slice(0, 4).padEnd(4, '0')}`;
  const [row] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id, phone`,
    [tenantAId, `Confirmação ${patientSeq} (${RUN.slice(0, 8)})`, phone.slice(0, 9), over.commPrefs ?? '{}'],
  );
  return row;
}

async function marcar(patientId: string, over: { daysAhead?: number; createdHoursAgo?: number } = {}) {
  const { daysAhead = 5, createdHoursAgo = 0 } = over;
  const [row] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, chair, appt_date, start_time, duration, type, status, created_at)
     VALUES ($1, $2, 1, (CURRENT_DATE + ($3::int * INTERVAL '1 day'))::date, '10:00', 45,
             'Consulta de Avaliação', 'confirmed', NOW() - ($4::int * INTERVAL '1 hour'))
     RETURNING id`,
    [tenantAId, patientId, daysAhead, createdHoursAgo],
  );
  return String(row.id);
}

function confirmacaoDe(appointmentId: string) {
  return queryOne(
    `SELECT id, payload, to_addr FROM notifications
      WHERE appointment_id=$1 AND payload->>'kind'='appointment_confirmation'`,
    [appointmentId],
  );
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
});

after(async () => {
  await closeTestDb();
});

test('uma marcação nova produz uma confirmação, com a data em português', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id));

  const r = await runJob(tenantAId, 'confirmations');
  assert.equal(r.ok, true);

  const n = await confirmacaoDe(consulta);
  assert.ok(n, 'devia ter sido enfileirada uma confirmação');
  const corpo = String((n.payload as Record<string, unknown>).body);
  assert.match(corpo, /fica marcada para/);
  // formatDatePT, não ISO — é o corpo de um SMS para um doente.
  assert.doesNotMatch(corpo, /\d{4}-\d{2}-\d{2}/);
  assert.match(corpo, /10:00/);
});

test('a segunda passagem não repete a confirmação', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id));

  await runJob(tenantAId, 'confirmations');
  await runJob(tenantAId, 'confirmations');

  const { rows } = await query(
    `SELECT id FROM notifications
      WHERE appointment_id=$1 AND payload->>'kind'='appointment_confirmation'`,
    [consulta],
  ).then((r) => ({ rows: r }));
  assert.equal(rows.length, 1, 'a guarda por consulta devia impedir a segunda');
});

// A janela é o que impede que ligar isto pela primeira vez confirme, de uma vez só,
// todas as consultas futuras já marcadas — incluindo as que o doente combinou há um mês.
test('uma consulta marcada há mais tempo do que a janela não é confirmada', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id), { createdHoursAgo: 48 });

  await runJob(tenantAId, 'confirmations');

  assert.equal(await confirmacaoDe(consulta), null);
});

// Uma consulta já passada não se confirma: a mensagem chegaria depois do facto.
test('uma consulta no passado não é confirmada', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id), { daysAhead: -3 });

  await runJob(tenantAId, 'confirmations');

  assert.equal(await confirmacaoDe(consulta), null);
});

// Defesa em profundidade: a tarefa verifica o consentimento antes de montar a mensagem e
// o árbitro verifica-o outra vez. Este teste cobre a primeira — sem ele, tirar a guarda
// da tarefa não partia nada visível.
test('quem recusou contacto automático não recebe confirmação', async () => {
  const doente = await doenteContactavel({ commPrefs: '{"doNotContact": ["sms"]}' });
  const consulta = await marcar(String(doente.id));

  await runJob(tenantAId, 'confirmations');

  assert.equal(await confirmacaoDe(consulta), null);
});

// O caso que motivou a guarda ser sobre QUALQUER mensagem da consulta e não só sobre uma
// confirmação anterior: marcar para o próprio dia cai na janela da confirmação e na do
// lembrete ao mesmo tempo. O doente não sabe que são dois sistemas — vê a clínica a
// repetir-se.
test('não confirma uma consulta para a qual já saiu outra mensagem', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id), { daysAhead: 1 });

  await query(
    `INSERT INTO notifications (tenant_id, patient_id, appointment_id, channel, to_addr, payload, status)
     VALUES ($1,$2,$3,'sms',$4,'{"kind":"appointment_reminder","body":"lembrete"}'::jsonb,'sent')`,
    [tenantAId, doente.id, consulta, doente.phone],
  );

  await runJob(tenantAId, 'confirmations');

  assert.equal(await confirmacaoDe(consulta), null);
});

// ─── Remarcação ─────────────────────────────────────────────────────────────
// A mesma tarefa cobre os dois factos, porque para o doente são o mesmo tipo de
// informação: onde e quando é a sua consulta. O que muda é o verbo.

async function remarcar(appointmentId: string, dias: number) {
  await query(
    `UPDATE appointments
        SET appt_date=(CURRENT_DATE + ($2::int * INTERVAL '1 day'))::date, rescheduled_at=NOW()
      WHERE id=$1`,
    [appointmentId, dias],
  );
}

test('uma consulta remarcada produz mensagem, mesmo já tendo sido confirmada antes', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id));

  await runJob(tenantAId, 'confirmations');
  const primeira = await confirmacaoDe(consulta);
  assert.ok(primeira);
  assert.match(String((primeira.payload as Record<string, unknown>).body), /fica marcada para/);

  await remarcar(consulta, 9);
  await runJob(tenantAId, 'confirmations');

  const todas = await query(
    `SELECT payload FROM notifications
      WHERE appointment_id=$1 AND payload->>'kind' IN ('appointment_confirmation','appointment_reschedule')
      ORDER BY created_at`,
    [consulta],
  );
  assert.equal(todas.length, 2, 'a remarcação devia produzir uma segunda mensagem');
  // O verbo muda: «fica marcada» a quem lhe mudaram o dia deixa a pessoa sem saber se é
  // a mesma consulta ou uma segunda.
  assert.match(String((todas[1].payload as Record<string, unknown>).body), /foi remarcada para/);
  assert.equal((todas[1].payload as Record<string, unknown>).moved, true);
});

test('remarcar duas vezes não repete a mensagem da primeira remarcação', async () => {
  const doente = await doenteContactavel();
  const consulta = await marcar(String(doente.id));
  await remarcar(consulta, 9);

  await runJob(tenantAId, 'confirmations');
  await runJob(tenantAId, 'confirmations');

  const todas = await query(
    `SELECT id FROM notifications
      WHERE appointment_id=$1 AND payload->>'kind' IN ('appointment_confirmation','appointment_reschedule')`,
    [consulta],
  );
  assert.equal(todas.length, 1);
});
