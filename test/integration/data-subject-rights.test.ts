// Direitos do titular (RGPD art. 15.º, 17.º e 20.º) ponta a ponta contra
// PostgreSQL real. A tabela `data_subject_requests` existia desde o schema
// inicial sem nenhum código a lê-la: registar o pedido não é cumpri-lo.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { erasePatient, exportPatientData } from '../../lib/dataSubject.ts';
import { query, queryOne } from '../../lib/db.ts';
import { computeLifecycleTransitions } from '../../lib/lifecycle.ts';
import { enforceRetentionPolicies } from '../../lib/retention.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

let tenantId: string;

before(async () => {
  await ensureSeeded();
  tenantId = await getTenantAId();
});
after(closeTestDb);

async function makePatient(name: string) {
  const [p] = await query(
    `INSERT INTO patients (tenant_id, name, phone, email, nif, status, country)
     VALUES ($1,$2,'912345678','titular@exemplo.pt','123456789','registered','PT') RETURNING *`,
    [tenantId, name],
  );
  return p;
}

test('exportação reúne o paciente e os seus registos (art. 15.º e 20.º)', async () => {
  const p = await makePatient('Titular Exportação');
  await query(`INSERT INTO patient_alerts (patient_id, alert) VALUES ($1,'Alergia a penicilina')`, [p.id]);
  await query(
    `INSERT INTO recalls (tenant_id, patient_id, recall_type, interval_months, next_due, active)
     VALUES ($1,$2,'Higiene',6,CURRENT_DATE,TRUE)`,
    [tenantId, p.id],
  );

  const data = await exportPatientData(tenantId, p.id);
  assert.ok(data, 'exportação devolveu conteúdo');
  assert.equal(data.subject.name, 'Titular Exportação');
  assert.equal(data.records.recalls.length, 1, 'os recalls do titular vieram');
  assert.ok(data.notes.length > 0, 'inclui a explicação do tratamento de cada tabela (art. 15.º n.º 1)');
  // Formato estruturado e legível por máquina, como o art. 20.º exige.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(data)));
});

test('exportação de outra clínica não devolve nada (isolamento mantém-se)', async () => {
  const p = await makePatient('Titular Isolado');
  const outra = '00000000-0000-0000-0000-000000000001';
  assert.equal(await exportPatientData(outra, p.id), null);
});

test('apagamento sever a identidade e conserva o registo clínico (art. 17.º n.º 3)', async () => {
  const p = await makePatient('Titular Apagamento');
  const [appt] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, patient_name, appt_date, start_time, duration, type, status, chair)
     VALUES ($1,$2,$3,CURRENT_DATE,'10:00',30,'Consulta','confirmed',1) RETURNING *`,
    [tenantId, p.id, 'Titular Apagamento'],
  );
  await query(`INSERT INTO patient_alerts (patient_id, alert) VALUES ($1,'nota operacional')`, [p.id]);

  const res = await erasePatient(tenantId, p.id);
  assert.ok(res, 'apagamento executou');

  const depois = await queryOne(`SELECT * FROM patients WHERE id=$1`, [p.id]);
  assert.equal(depois.name, 'Paciente anonimizado');
  assert.equal(depois.phone, null, 'telefone removido');
  assert.equal(depois.email, null, 'email removido');
  assert.equal(depois.nif, null, 'NIF removido');
  assert.equal(depois.status, 'anonymized');

  // A marcação sobrevive — é registo clínico — mas sem o nome no instantâneo.
  const apptDepois = await queryOne(`SELECT * FROM appointments WHERE id=$1`, [appt.id]);
  assert.ok(apptDepois, 'a marcação foi conservada');
  assert.equal(apptDepois.patient_name, 'Paciente anonimizado', 'o instantâneo do nome foi limpo');

  // Os dados operacionais desaparecem.
  const alertas = await query(`SELECT 1 FROM patient_alerts WHERE patient_id=$1`, [p.id]);
  assert.equal(alertas.length, 0, 'notas operacionais apagadas');
});

test('depois do apagamento, o paciente sai das listas e das campanhas', async () => {
  const p = await makePatient('Titular Invisível');
  await query(`UPDATE patients SET visit_count=3, last_visit=CURRENT_DATE - 400 WHERE id=$1`, [p.id]);
  await erasePatient(tenantId, p.id);

  // Lista da receção: a mesma consulta de GET /api/patients.
  const listados = await query(
    `SELECT p.id FROM patients p
     WHERE p.tenant_id=$1 AND p.status <> 'anonymized' AND p.id=$2`,
    [tenantId, p.id],
  );
  assert.equal(listados.length, 0, 'não aparece na lista de pacientes');

  // Campanhas de reativação: quem pediu para ser esquecido não é recontactado.
  const { outreachCandidates } = await computeLifecycleTransitions(tenantId);
  assert.ok(
    !outreachCandidates.some((c) => c.patientId === p.id),
    'não entra nas campanhas de reativação',
  );
});

test('apagamento de um paciente inexistente devolve null em vez de rebentar', async () => {
  assert.equal(await erasePatient(tenantId, '00000000-0000-0000-0000-0000000000ff'), null);
});

test('política de conservação automática apaga; a que toca no clínico só sinaliza', async () => {
  await query(`DELETE FROM data_retention_policies WHERE tenant_id=$1`, [tenantId]);
  await query(
    `INSERT INTO data_retention_policies (tenant_id, data_category, retention_days, action, active)
     VALUES ($1,'notifications',30,'delete',TRUE), ($1,'inactive_patients',3650,'anonymize',TRUE)`,
    [tenantId],
  );
  const p = await makePatient('Titular Notificado');
  await query(
    `INSERT INTO notifications (tenant_id, patient_id, channel, to_addr, payload, status, created_at)
     VALUES ($1,$2,'sms','+351912345678','{"kind":"test"}'::jsonb,'sent', NOW() - INTERVAL '90 days')`,
    [tenantId, p.id],
  );

  const res = await enforceRetentionPolicies(tenantId);
  const notif = res.outcomes.find((o) => o.category === 'notifications');
  const inativos = res.outcomes.find((o) => o.category === 'inactive_patients');

  assert.equal(notif?.mode, 'auto');
  assert.ok((notif?.applied ?? 0) >= 1, 'a mensagem antiga foi mesmo apagada');
  assert.equal(inativos?.mode, 'review', 'dados clínicos nunca são apagados automaticamente');
  assert.equal(inativos?.applied, 0, 'e nada foi aplicado nessa categoria');
});

test('categoria desconhecida fica visível em vez de falhar em silêncio', async () => {
  await query(`DELETE FROM data_retention_policies WHERE tenant_id=$1`, [tenantId]);
  await query(
    `INSERT INTO data_retention_policies (tenant_id, data_category, retention_days, action, active)
     VALUES ($1,'categoria_inventada',30,'delete',TRUE)`,
    [tenantId],
  );
  const res = await enforceRetentionPolicies(tenantId);
  assert.equal(res.outcomes[0].mode, 'unknown', 'a política que ninguém sabe aplicar aparece como tal');
});
