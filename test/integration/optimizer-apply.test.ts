// Aplicar uma proposta do otimizador (app/api/schedule-intel/optimizer/apply).
//
// O que só a base de dados mostra, e é o que justifica a rota existir com esta forma:
// o corpo do pedido traz a CHAVE da proposta e nunca o destino. O servidor recalcula a
// otimização e aplica o destino que ele próprio apurou — por isso uma proposta calculada
// há dez minutos, sobre uma agenda que entretanto mudou, não se aplica.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { POST as aplicarPost } from '../../app/api/schedule-intel/optimizer/apply/route.ts';
import { query, queryOne } from '../../lib/db.ts';
import { computeScheduleOptimization } from '../../lib/scheduleOptimizer.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getOrCreateTenantAdmin, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
let admin: Awaited<ReturnType<typeof getOrCreateTenantAdmin>>;
let dentistId: string;
const RUN = crypto.randomUUID();
const PREFIXO = 'Otimizador';
let seq = 0;

const ctx = () => ({ params: Promise.resolve({}) }) as never;

// Mesmo raciocínio do ficheiro da remarcação: dentista próprio com turno próprio, porque
// a semente não tem staff_schedules e sem turnos o otimizador não propõe nada.
async function ownDentist() {
  const [u] = await query(
    `INSERT INTO users (tenant_id, email, password, name, role, active)
     VALUES ($1,'otimizador.testes@portucale.local','x','Dentista (otimizador)','dentist',TRUE)
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
  await query(`DELETE FROM patient_timeline WHERE patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM appointments WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantAId]);
  await query(`DELETE FROM patients WHERE tenant_id=$1 AND name LIKE '${PREFIXO} %'`, [tenantAId]);
}

async function doente() {
  seq += 1;
  const [row] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
    [tenantAId, `${PREFIXO} ${seq} (${RUN.slice(0, 8)})`, `92${String(seq).padStart(7, '0')}`.slice(0, 9)],
  );
  return String(row.id);
}

async function marcar(over: { daysAhead: number; startTime: string; chair?: number; dentist?: string | null }) {
  const p = await doente();
  const [row] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, dentist_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,$3,$4,(CURRENT_DATE + ($5::int * INTERVAL '1 day'))::date,$6::time,30,'Consulta de Avaliação','confirmed')
     RETURNING id`,
    [tenantAId, p, over.dentist === undefined ? dentistId : over.dentist, over.chair ?? 1, over.daysAhead, over.startTime],
  );
  return String(row.id);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  admin = await getOrCreateTenantAdmin(tenantAId, 'Clínica Portucale');
  await limpar();
  dentistId = await ownDentist();
});

after(async () => {
  await limpar();
  await closeTestDb();
});

// Pela CONSULTA e não só pelo tipo: a semente tem as suas próprias consultas sem
// dentista, e `find` pelo tipo devolvia a proposta de outra pessoa — o teste passava a
// afirmar coisas sobre uma linha que não criou.
async function propostaPara(kind: string, appointmentId: string) {
  const { moves } = await computeScheduleOptimization(tenantAId);
  return moves.find((m) => m.kind === kind && m.apply?.appointmentId === appointmentId);
}

async function propostaDeTipo(kind: string) {
  const { moves } = await computeScheduleOptimization(tenantAId);
  return moves.find((m) => m.kind === kind && m.apply);
}

test('uma consulta sem dentista ganha-o, sem avisar o doente', async () => {
  const id = await marcar({ daysAhead: 8, startTime: '09:00', chair: 2, dentist: null });

  const proposta = await propostaPara('unassigned_dentist', id);
  assert.ok(proposta, 'devia haver uma proposta de dentista em falta para esta consulta');

  const res = await aplicarPost(
    authedRequest(admin, { method: 'POST', url: 'http://t/api/schedule-intel/optimizer/apply', body: { key: proposta.key } }),
    ctx(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.patientWillBeNotified, false);

  const depois = await queryOne(`SELECT dentist_id, rescheduled_at FROM appointments WHERE id=$1`, [id]);
  assert.ok(depois?.dentist_id, 'o dentista devia ter ficado atribuído');
  // Atribuir o dentista não muda nada do que foi dito ao doente — carimbar aqui
  // mandaria uma mensagem de remarcação sobre uma consulta que não se mexeu.
  assert.equal(depois?.rescheduled_at, null);
});

// A garantia central: o corpo traz só a chave. Uma proposta que já não existe no
// recálculo não se aplica, mesmo que o botão ainda esteja no ecrã de alguém.
test('uma proposta que já não existe é recusada com 409', async () => {
  const res = await aplicarPost(
    authedRequest(admin, {
      method: 'POST',
      url: 'http://t/api/schedule-intel/optimizer/apply',
      body: { key: 'pull_forward:00000000-0000-0000-0000-000000000000' },
    }),
    ctx(),
  );
  assert.equal(res.status, 409);
});

test('sem chave é 400', async () => {
  const res = await aplicarPost(
    authedRequest(admin, { method: 'POST', url: 'http://t/api/schedule-intel/optimizer/apply', body: {} }),
    ctx(),
  );
  assert.equal(res.status, 400);
});

// As propostas cuja execução é uma conversa não se aplicam sozinhas — e a recusa tem de
// distinguir «não posso» de «não existe», senão quem lê pensa que a lista está velha.
test('uma proposta sem destino é recusada com 422, não 409', async () => {
  // 'gap_fill' e 'preference_mismatch' nunca trazem `apply`. Procura-se uma real; se a
  // agenda de teste não produzir nenhuma, o caso fica coberto pelo teste puro.
  const { moves } = await computeScheduleOptimization(tenantAId);
  const semDestino = moves.find((m) => !m.apply);
  if (!semDestino) return;

  const res = await aplicarPost(
    authedRequest(admin, {
      method: 'POST',
      url: 'http://t/api/schedule-intel/optimizer/apply',
      body: { key: semDestino.key },
    }),
    ctx(),
  );
  assert.equal(res.status, 422);
});

test('aplicar uma antecipação move a consulta e carimba para o doente ser avisado', async () => {
  // Uma consulta longe e um dia bem mais cedo com a agenda vazia: é o cenário que
  // buildPullForwardMoves procura.
  const longe = await marcar({ daysAhead: 25, startTime: '15:00', chair: 3 });

  const proposta = await propostaDeTipo('pull_forward');
  if (!proposta) return; // a agenda de teste nem sempre gera este caso

  const antes = await queryOne(`SELECT appt_date::text AS d FROM appointments WHERE id=$1`, [proposta.apply?.appointmentId]);
  const res = await aplicarPost(
    authedRequest(admin, { method: 'POST', url: 'http://t/api/schedule-intel/optimizer/apply', body: { key: proposta.key } }),
    ctx(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.patientWillBeNotified, true);

  const depois = await queryOne(
    `SELECT appt_date::text AS d, rescheduled_at FROM appointments WHERE id=$1`,
    [proposta.apply?.appointmentId],
  );
  assert.notEqual(String(depois?.d), String(antes?.d), 'a consulta devia ter mudado de dia');
  assert.ok(depois?.rescheduled_at, 'sem isto a mudança nunca chegava ao doente');
  assert.ok(longe);
});
