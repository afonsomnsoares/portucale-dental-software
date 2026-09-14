// Integration tests for app/api/appointments. Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DELETE as deleteAppointment, PUT as putAppointment } from '../../app/api/appointments/[id]/route.ts';
import { POST as postAppointments } from '../../app/api/appointments/route.ts';
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

let receptionistA: TestUser;
let superAdmin: TestUser;
let patientAId: string;
let dentistAId: string;
let tenantAId: string;

before(async () => {
  await ensureSeeded();
  receptionistA = await getSeededUser('rececao@portucale.dental');
  superAdmin = await getSeededUser('admin@portucale.dental');
  tenantAId = await getTenantAId();
  patientAId = await getSeededPatientId(tenantAId);
  dentistAId = await getSeededDentistId(tenantAId);
});

after(closeTestDb);

// ─── Uma marcação criada e não desfeita ocupa a vaga na corrida seguinte ────
// Com a data fixa que aqui estava ('2026-09-01' às 09:00), este teste passava à
// primeira e devolvia 409 a partir da segunda: a consulta da corrida anterior continua
// na base, e o guarda de dupla-marcação — que está correto — recusa a nova. O teste
// acusava a aplicação de um erro que era dele.
//
// A vaga passa a ser única por corrida. Escolher um dia distinto é mais fiável do que
// apagar no fim: se uma asserção falhar a meio, não fica lixo a envenenar a corrida
// seguinte, que é justamente quando se quer o teste a dizer a verdade.
const VAGA_UNICA = (() => {
  const base = new Date('2030-01-01T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 3650));
  return { date: base.toISOString().slice(0, 10), startTime: '09:00' };
})();

test('caminho feliz: receptionist marca uma consulta', async () => {
  const res = await postAppointments(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: {
        patientId: patientAId,
        dentistId: dentistAId,
        date: VAGA_UNICA.date,
        startTime: VAGA_UNICA.startTime,
        type: 'Consulta',
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.patient_id, patientAId);
});

test('POST com dentista inexistente/de outro tenant é rejeitado (400)', async () => {
  const res = await postAppointments(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: {
        patientId: patientAId,
        dentistId: crypto.randomUUID(),
        date: '2026-09-02',
        startTime: '10:00',
        type: 'Consulta',
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 400);
});

// ─── Este teste documentava um buraco; hoje documenta o seu fecho ───────────
// Na versão anterior afirmava uma assimetria real: o PUT recusava o super-admin sem
// clínica (403) e o DELETE deixava-o passar (200), porque a verificação de posse era
// `$2::uuid IS NULL OR tenant_id=$2::uuid` e um tenantId a null desligava o filtro.
// Um super-admin apagava a consulta de qualquer clínica sem nunca dizer em qual estava.
//
// A consolidação em lib/route.ts fechou isso: `tenant: 'required'` resolve a clínica
// ANTES do handler e recusa quem não tenha uma, de forma igual nos dois verbos. O
// super-admin continua a poder fazer as duas coisas — mas só de dentro de uma clínica,
// pelo cookie `acting_tenant` que POST /api/tenants/enter grava.
//
// O teste ficou a falhar porque a suite de integração não corria (ver .env.test): tinha
// congelado o contrato antigo e ninguém o viu mudar. Agora afirma o contrato novo, nas
// duas metades — barrado fora de uma clínica, dentro dela a funcionar.
test('super-admin: fora de uma clínica é barrado no PUT e no DELETE, sem assimetria entre eles', async () => {
  const createRes = await postAppointments(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: { patientId: patientAId, dentistId: dentistAId, date: '2026-09-03', startTime: '11:00', type: 'Consulta' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // Sem clínica ativa, `tenant: 'required'` não tem clínica que resolver — 403 antes de
  // o handler correr.
  const putRes = await putAppointment(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/appointments/${created.id}`,
      body: { notes: 'tentativa de super-admin' },
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(putRes.status, 403, 'super-admin fora de uma clínica é barrado no PUT');

  // O ponto do teste: o DELETE responde o MESMO. Era aqui que ele passava com 200.
  const deleteRes = await deleteAppointment(
    authedRequest(superAdmin, { method: 'DELETE', url: `/api/appointments/${created.id}` }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(
    deleteRes.status,
    403,
    'super-admin fora de uma clínica é barrado também no DELETE — era esta a assimetria',
  );

  // E de dentro da clínica, os dois verbos funcionam: o que fecha o buraco não é tirar
  // poder ao super-admin, é obrigá-lo a dizer de que clínica está a falar.
  const putDentro = await putAppointment(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/appointments/${created.id}`,
      body: { notes: 'super-admin dentro da clínica' },
      actingTenant: tenantAId,
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(putDentro.status, 200, 'dentro da clínica, o PUT passa');
  assert.equal((await putDentro.json()).notes, 'super-admin dentro da clínica');

  const deleteDentro = await deleteAppointment(
    authedRequest(superAdmin, {
      method: 'DELETE',
      url: `/api/appointments/${created.id}`,
      actingTenant: tenantAId,
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(deleteDentro.status, 200, 'dentro da clínica, o DELETE passa');
  assert.equal((await deleteDentro.json()).deleted, true);
});
