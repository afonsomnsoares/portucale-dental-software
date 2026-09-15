// Testes de integração de app/api/patients/[id]/medical-history. Correr com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// Esta rota tinha dois defeitos ao mesmo tempo, e um escondia o outro:
//
//   1. O INSERT não incluía `tenant_id`, que é NOT NULL sem default e sem trigger.
//      Toda e qualquer gravação de anamnese rebentava com 23502 — em todas as
//      instalações, desde sempre. PRODUCT.md dá a anamnese como «Construído».
//   2. Era a única sub-rota de doente sem getOwnedPatient. O 500 do ponto 1 é que
//      a fazia falhar fechada; corrigir só a coluna teria aberto uma escrita de
//      registo clínico entre clínicas.
//
// Por isso há aqui duas famílias de testes: a anamnese grava, e não grava na
// clínica do lado.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as getHistory, PUT as putHistory } from '../../app/api/patients/[id]/medical-history/route.ts';
import { authedRequest, type TestUser } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getSeededPatientId,
  getSeededUser,
  getTenantAId,
  getTenantBId,
} from '../helpers/testDb.ts';

let dentistA: TestUser;
let patientAId: string;
let patientBId: string;

before(async () => {
  await ensureSeeded();
  const tenantAId = await getTenantAId();
  const tenantBId = await getTenantBId();
  dentistA = await getSeededUser('medico@portucale.dental');
  patientAId = await getSeededPatientId(tenantAId);
  patientBId = await getSeededPatientId(tenantBId);
});

after(async () => {
  await closeTestDb();
});

function put(user: TestUser, patientId: string, body: unknown) {
  return putHistory(
    authedRequest(user, {
      method: 'PUT',
      url: `http://localhost/api/patients/${patientId}/medical-history`,
      body,
    }),
    { params: Promise.resolve({ id: patientId }) },
  );
}

test('caminho feliz: gravar a anamnese de um doente da própria clínica devolve 200', async () => {
  const res = await put(dentistA, patientAId, {
    allergies: 'Penicilina',
    medications: 'Varfarina',
    conditions: 'Hipertensão',
    family_history: '',
    smoking: 'Não',
    pregnancy: 'Não aplicável',
    notes: 'Confirmar INR antes de extração.',
  });

  assert.equal(res.status, 200, 'era isto que devolvia 500 com 23502');
  const row = await res.json();
  assert.equal(row.allergies, 'Penicilina');
  assert.ok(row.tenant_id, 'a linha tem de ficar com tenant_id preenchido');
});

test('o ON CONFLICT actualiza em vez de duplicar, e continua a gravar', async () => {
  await put(dentistA, patientAId, { allergies: 'Primeira' });
  const res = await put(dentistA, patientAId, { allergies: 'Segunda', notes: 'revisto' });

  assert.equal(res.status, 200);
  const row = await res.json();
  assert.equal(row.allergies, 'Segunda');
  assert.equal(row.notes, 'revisto');
});

test('o que se gravou é o que o GET devolve a seguir', async () => {
  await put(dentistA, patientAId, { allergies: 'Látex', conditions: 'Asma' });

  const res = await getHistory(
    authedRequest(dentistA, { url: `http://localhost/api/patients/${patientAId}/medical-history` }),
    { params: Promise.resolve({ id: patientAId }) },
  );

  assert.equal(res.status, 200);
  const row = await res.json();
  assert.equal(row.allergies, 'Látex');
  assert.equal(row.conditions, 'Asma');
});

test('um doente de outra clínica devolve 404, não uma escrita silenciosa', async () => {
  const res = await put(dentistA, patientBId, { allergies: 'INJETADO' });

  assert.equal(res.status, 404, 'sem getOwnedPatient isto escrevia na clínica B');
});

test('a tentativa falhada não deixou nada para trás na clínica B', async () => {
  // O 404 acima só vale se não tiver escrito antes de recusar.
  const { query } = await import('../../lib/db.ts');
  const rows = await query(`SELECT allergies FROM medical_history WHERE patient_id=$1`, [patientBId]);
  const leaked = rows.some((r) => (r as { allergies?: string }).allergies === 'INJETADO');
  assert.equal(leaked, false, 'a anamnese da clínica B foi escrita a partir da clínica A');
});

test('o tenant_id gravado é o do doente, e não o que vier no corpo do pedido', async () => {
  const foreign = await getTenantBId();
  await put(dentistA, patientAId, { allergies: 'Ibuprofeno', tenant_id: foreign, tenantId: foreign });

  const { query } = await import('../../lib/db.ts');
  const [row] = (await query(`SELECT tenant_id FROM medical_history WHERE patient_id=$1`, [patientAId])) as {
    tenant_id: string;
  }[];
  assert.notEqual(row.tenant_id, foreign, 'o corpo do pedido não pode escolher o tenant');
  assert.equal(row.tenant_id, await getTenantAId());
});
