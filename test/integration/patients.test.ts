// Integration tests for app/api/patients — invokes the exported route handlers directly
// against a real Postgres test database (see test/helpers/testDb.ts). Run with:
//   node --import tsx --env-file=.env.test --test test/integration/
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getPatientById } from '../../app/api/patients/[id]/route.ts';
import { GET as getPatients, POST as postPatients } from '../../app/api/patients/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getSeededPatientId,
  getSeededUser,
  getTenantBId,
} from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let receptionistA: TestUser;
let dentistA: TestUser;
let patientBId: string;

before(async () => {
  await ensureSeeded();
  receptionistA = await getSeededUser('rececao@portucale.dental');
  dentistA = await getSeededUser('medico@portucale.dental');
  patientBId = await getSeededPatientId(await getTenantBId());
});

after(closeTestDb);

test('caminho feliz: receptionist cria um paciente e lê-o de volta', async () => {
  const createRes = await postPatients(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/patients',
      // Clínica Portucale's seeded schema_fields mark tobacco_use + allergy_penicillin as
      // required (100% rollout) — omitting them is a real 400, not a bug, so both are set.
      body: {
        name: 'Paciente Teste Integração',
        customFields: { tobacco_use: 'nunca', allergy_penicillin: false },
      },
    }),
   { params: Promise.resolve({}) });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.name, 'Paciente Teste Integração');

  const getRes = await getPatientById(
    authedRequest(receptionistA, { method: 'GET', url: `/api/patients/${created.id}` }),
    { params: Promise.resolve({ id: created.id }) },
  );
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.id, created.id);
});

test('isolamento de tenant: GET /api/patients (listagem) não devolve pacientes de outro tenant', async () => {
  const res = await getPatients(authedRequest(receptionistA, { method: 'GET', url: '/api/patients' }), { params: Promise.resolve({}) });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.length > 0);
  assert.ok(!rows.some((p: { id: string }) => p.id === patientBId), 'listagem vazou um paciente de outro tenant');
});

test('isolamento de tenant: GET /api/patients/[id] de outro tenant devolve 404', async () => {
  const res = await getPatientById(authedRequest(receptionistA, { method: 'GET', url: `/api/patients/${patientBId}` }), {
    params: Promise.resolve({ id: patientBId }),
  });
  assert.equal(res.status, 404);
});

test('dentista sem patients:create recebe 403 ao tentar criar paciente', async () => {
  const res = await postPatients(
    authedRequest(dentistA, { method: 'POST', url: '/api/patients', body: { name: 'Não devia ser criado' } }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 403);
});
