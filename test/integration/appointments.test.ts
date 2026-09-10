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

before(async () => {
  await ensureSeeded();
  receptionistA = await getSeededUser('rececao@portucale.dental');
  superAdmin = await getSeededUser('admin@portucale.dental');
  const tenantAId = await getTenantAId();
  patientAId = await getSeededPatientId(tenantAId);
  dentistAId = await getSeededDentistId(tenantAId);
});

after(closeTestDb);

test('caminho feliz: receptionist marca uma consulta', async () => {
  const res = await postAppointments(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: { patientId: patientAId, dentistId: dentistAId, date: '2026-09-01', startTime: '09:00', type: 'Consulta' },
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

test('assimetria existente: super-admin é bloqueado no PUT mas consegue DELETE a mesma consulta', async () => {
  const createRes = await postAppointments(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/appointments',
      body: { patientId: patientAId, dentistId: dentistAId, date: '2026-09-03', startTime: '11:00', type: 'Consulta' },
    }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // app/api/appointments/[id]/route.ts:16-17 forces forbidden() whenever the caller has no
  // tenantId, even though hasPermission() already allowed a super-admin through — a
  // super-admin therefore cannot edit ANY appointment via this route today.
  const putRes = await putAppointment(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: `/api/appointments/${created.id}`,
      body: { notes: 'tentativa de super-admin' },
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(putRes.status, 403, 'super-admin devia ser bloqueado no PUT — comportamento existente, não é um bug novo');

  // DELETE's ownership check uses `$2::uuid IS NULL OR tenant_id=$2::uuid`, which bypasses
  // the tenant filter entirely for a super-admin (tenantId null) — so the same super-admin
  // blocked above CAN delete this tenant A appointment. Documenting the asymmetry, not fixing it.
  const deleteRes = await deleteAppointment(
    authedRequest(superAdmin, { method: 'DELETE', url: `/api/appointments/${created.id}` }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(deleteRes.status, 200, 'super-admin consegue apagar a mesma consulta — assimetria real, documentada aqui');
  const deleted = await deleteRes.json();
  assert.equal(deleted.deleted, true);
});
