// Integration tests para o lançamento do valor no fim da consulta (migração 042).
//
// O modelo do produto: a plataforma NÃO processa pagamentos nem emite documentos
// fiscais. No fim da consulta alguém coloca o valor, e isso fica na conta corrente do
// doente. Estes testes fixam esse comportamento e as suas fronteiras. Run com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PUT as putStatus } from '../../app/api/appointments/[id]/status/route.ts';
import { POST as postAppointment } from '../../app/api/appointments/route.ts';
import { query } from '../../lib/db.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getSeededDentistId,
  getSeededPatientId,
  getSeededUser,
  getTenantAId,
} from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

// Marcador para as consultas deste ficheiro. Sem isto, correr a suite duas vezes contra
// a mesma base falha com 409 (dupla marcação) — as linhas da corrida anterior continuam
// lá. Ver o mesmo problema, por resolver, em test/integration/appointments.test.ts.
// A limpeza é por DATA e não por tipo: a data é exclusiva deste ficheiro, e assim apanha
// também o que ficou de versões anteriores do próprio teste.
const TEST_TYPE = 'Consulta (teste valor)';
const TEST_DATE = '2027-03-15';

let receptionistA: TestUser;
let dentistA: TestUser;
let patientAId: string;
let dentistAId: string;
let tenantAId: string;

before(async () => {
  await ensureSeeded();
  receptionistA = await getSeededUser('rececao@portucale.dental');
  dentistA = await getSeededUser('medico@portucale.dental');
  tenantAId = await getTenantAId();
  patientAId = await getSeededPatientId(tenantAId);
  dentistAId = await getSeededDentistId(tenantAId);

  // Limpa o que uma corrida anterior deixou, para o suite ser repetível.
  await query(
    `DELETE FROM invoices WHERE appointment_id IN (SELECT id FROM appointments WHERE appt_date=$1::date)`,
    [TEST_DATE],
  );
  await query(`DELETE FROM appointments WHERE appt_date=$1::date`, [TEST_DATE]);
});

after(closeTestDb);

let slot = 8;
// Leva uma consulta nova até 'ready-dismissal', que é o estado a partir do qual o
// doente pode sair. Cada chamada usa uma hora diferente para não colidir com a anterior.
async function appointmentReadyToLeave() {
  const startTime = `${String(slot++).padStart(2, '0')}:30`;
  const res = await postAppointment(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: {
        patientId: patientAId,
        dentistId: dentistAId,
        date: TEST_DATE,
        startTime,
        type: TEST_TYPE,
      },
    }),
  );
  assert.equal(res.status, 201, 'a consulta de teste tem de ser criada');
  const apt = await res.json();

  for (const next of ['waiting', 'in-operatory', 'ready-dismissal']) {
    const r = await putStatus(
      authedRequest(receptionistA, { method: 'PUT', url: `/api/appointments/${apt.id}/status`, body: { status: next } }),
      { params: Promise.resolve({ id: apt.id }) },
    );
    assert.equal(r.status, 200, `transição para ${next}`);
  }
  return apt;
}

test('fecho com valor: cria o registo ligado à consulta e soma ao saldo do doente', async () => {
  const apt = await appointmentReadyToLeave();
  const [{ balance: antes }] = await query(`SELECT balance FROM patients WHERE id=$1`, [patientAId]);

  const res = await putStatus(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed', amount: 75 },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.invoice, 'a resposta traz o registo criado');
  assert.equal(Number(body.invoice.amount), 75);
  assert.equal(body.invoice.appointment_id, apt.id, 'o valor fica preso à consulta que o gerou');
  assert.equal(body.invoice.status, 'pending', 'nasce por liquidar — a plataforma não recebe dinheiro');

  const [{ balance: depois }] = await query(`SELECT balance FROM patients WHERE id=$1`, [patientAId]);
  assert.equal(Number(depois), Number(antes) + 75, 'o saldo do doente sobe pelo valor lançado');
});

test('fecho sem valor: a consulta fecha na mesma e não nasce registo nenhum', async () => {
  const apt = await appointmentReadyToLeave();

  const res = await putStatus(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed' },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'departed');
  assert.equal(body.invoice, null, 'nem toda a consulta cobra');

  const rows = await query(`SELECT id FROM invoices WHERE appointment_id=$1`, [apt.id]);
  assert.equal(rows.length, 0);
});

test('uma consulta gera no máximo um valor', async () => {
  const apt = await appointmentReadyToLeave();
  await putStatus(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed', amount: 50 },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );

  // 'departed' é terminal — a segunda tentativa é recusada pelo próprio workflow, antes
  // sequer de chegar ao registo do valor.
  const segunda = await putStatus(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed', amount: 50 },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(segunda.status, 400);

  const rows = await query(`SELECT id FROM invoices WHERE appointment_id=$1`, [apt.id]);
  assert.equal(rows.length, 1, 'continua a haver um só registo');
});

test('valor inválido é recusado com 400 em vez de ser descartado em silêncio', async () => {
  const apt = await appointmentReadyToLeave();
  for (const amount of [0, -10, 'muito']) {
    const res = await putStatus(
      authedRequest(receptionistA, {
        method: 'PUT',
        url: `/api/appointments/${apt.id}/status`,
        body: { status: 'departed', amount },
      }),
      { params: Promise.resolve({ id: apt.id }) },
    );
    assert.equal(res.status, 400, `amount=${amount} tem de ser recusado`);
  }

  const [row] = await query(`SELECT status FROM appointments WHERE id=$1`, [apt.id]);
  assert.equal(row.status, 'ready-dismissal', 'a consulta não pode ter fechado com um valor inválido');
});

test('o valor só pode ser lançado no fecho, não noutra transição qualquer', async () => {
  const apt = await appointmentReadyToLeave();
  const res = await putStatus(
    authedRequest(receptionistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'waiting', amount: 30 },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(res.status, 400);
});

test('o dentista fecha a consulta mas não lança valores (não tem invoices:create)', async () => {
  const apt = await appointmentReadyToLeave();

  const comValor = await putStatus(
    authedRequest(dentistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed', amount: 40 },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(comValor.status, 403, 'mudar estado não dá direito a criar conta corrente');

  const semValor = await putStatus(
    authedRequest(dentistA, {
      method: 'PUT',
      url: `/api/appointments/${apt.id}/status`,
      body: { status: 'departed' },
    }),
    { params: Promise.resolve({ id: apt.id }) },
  );
  assert.equal(semValor.status, 200, 'mas continua a poder fechar a consulta');
});
