// O fluxo de remarcação (app/api/appointments/[id]/reschedule).
//
// Integração e não puro por duas razões que só a base de dados responde: a verificação de
// sobreposição corre dentro de uma transação com advisory lock (o PUT de edição nunca a
// teve — é a diferença que este ficheiro tranca), e as alternativas vêm do motor de
// sugestões, que lê turnos, férias, cadeiras e equipamento.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PUT as editarPut } from '../../app/api/appointments/[id]/route.ts';
import { GET as sugestoesGet, POST as remarcarPost } from '../../app/api/appointments/[id]/reschedule/route.ts';
import { query, queryOne } from '../../lib/db.ts';
import { suggestAppointmentSlots } from '../../lib/scheduling.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getOrCreateTenantAdmin, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
let admin: Awaited<ReturnType<typeof getOrCreateTenantAdmin>>;
let dentistId: string;
const RUN = crypto.randomUUID();
let seq = 0;

// ─── Este ficheiro traz o seu próprio dentista, com horário próprio ─────────
// Duas razões, e as duas morderam a escrever isto.
//
// A semente NÃO tem staff_schedules nenhum, e sem turnos o motor de sugestões não
// devolve horário nenhum (getWorkingWindows → sem janelas → sem candidatos). Um teste
// das alternativas contra a semente crua estaria a afirmar que uma lista vazia é uma
// lista — que foi exatamente o que aconteceu na primeira versão.
//
// Criar turnos para um dentista da semente resolveria isso e estragaria outra coisa: a
// disponibilidade da equipa é lida por outros ficheiros da suite, que correm em paralelo.
// Um dentista só deste ficheiro não é visto por nenhum deles.
const DENTIST_EMAIL = 'remarcar.testes@portucale.local';

async function ownDentist(tenantId: string) {
  const [u] = await query(
    `INSERT INTO users (tenant_id, email, password, name, role, active)
     VALUES ($1,$2,'x','Dentista (remarcação)','dentist',TRUE)
     ON CONFLICT (email) DO UPDATE SET active=TRUE
     RETURNING id`,
    [tenantId, DENTIST_EMAIL],
  );
  const id = String(u.id);
  // Todos os dias da semana, 08:00–20:00: torna a aritmética de datas do teste
  // irrelevante. Qualquer dia futuro serve, e a asserção deixa de depender de o
  // CURRENT_DATE + N calhar a um dia útil — que é uma flutuação que só se manifesta
  // em alguns dias da semana e é exatamente o género de teste que falha à sexta.
  await query(`DELETE FROM staff_schedules WHERE user_id=$1`, [id]);
  for (let weekday = 0; weekday <= 6; weekday++) {
    await query(
      `INSERT INTO staff_schedules (tenant_id, user_id, weekday, start_time, end_time)
       VALUES ($1,$2,$3,'08:00','20:00')`,
      [tenantId, id, weekday],
    );
  }
  return id;
}

// ─── E limpa o que deixou ───────────────────────────────────────────────────
// A base de testes não é recriada entre corridas. Sem isto, a consulta que a corrida
// anterior moveu para CURRENT_DATE+12 às 15:00 continua lá, e a desta corrida colide com
// ela: o teste passa uma vez e dá 409 em todas as seguintes, a apontar para um bug de
// produto que não existe. É a mesma armadilha que o cabeçalho de
// test/integration/inbound-and-coordination.ts descreve para os MessageSid.
async function limparCorridasAnteriores(tenantId: string) {
  const alvo = `SELECT id FROM patients WHERE tenant_id=$1 AND name LIKE 'Remarcar %'`;
  // A timeline primeiro, e de propósito: patient_timeline referencia patients SEM
  // ON DELETE (migração 014 — RESTRICT), porque o histórico de um doente não deve
  // desaparecer por alguém apagar a ficha. Aqui é o que a remarcação escreveu.
  await query(`DELETE FROM patient_timeline WHERE patient_id IN (${alvo})`, [tenantId]);
  await query(`DELETE FROM appointments WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [tenantId]);
  await query(`DELETE FROM patients WHERE tenant_id=$1 AND name LIKE 'Remarcar %'`, [tenantId]);
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

async function doente() {
  seq += 1;
  const [row] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
    [tenantAId, `Remarcar ${seq} (${RUN.slice(0, 8)})`, `93${String(seq).padStart(7, '0')}`.slice(0, 9)],
  );
  return String(row.id);
}

async function marcar(over: { daysAhead?: number; startTime?: string; chair?: number; status?: string } = {}) {
  const { daysAhead = 5, startTime = '10:00', chair = 1, status = 'confirmed' } = over;
  const p = await doente();
  const [row] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, dentist_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,$3,$4,(CURRENT_DATE + ($5::int * INTERVAL '1 day'))::date,$6::time,45,'Consulta de Avaliação',$7)
     RETURNING id`,
    [tenantAId, p, dentistId, chair, daysAhead, startTime, status],
  );
  return String(row.id);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  admin = await getOrCreateTenantAdmin(tenantAId, 'Clínica Portucale');
  await limparCorridasAnteriores(tenantAId);
  dentistId = await ownDentist(tenantAId);
});

after(async () => {
  await limparCorridasAnteriores(tenantAId);
  await closeTestDb();
});

test('as alternativas herdam o tipo e a duração da consulta', async () => {
  const id = await marcar();
  const res = await sugestoesGet(authedRequest(admin, { url: `http://t/api/appointments/${id}/reschedule` }), ctx(id));
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.current.type, 'Consulta de Avaliação');
  assert.equal(body.duration, 45);
  assert.ok(Array.isArray(body.slots));
});

// A consulta que se está a mover ocupa o seu próprio lugar. Sem a exclusão, a hora dela
// e as imediatamente à volta apareciam bloqueadas — e «mover das 10:00 para as 10:30 no
// mesmo dia» é o pedido mais comum ao telefone e era o único que o motor não propunha.
//
// Testado contra o motor e não contra a rota: a rota devolve os N melhores por
// ordenação, e a diferença que interessa está no MEIO do dia. Comparar as duas chamadas
// — com e sem exclusão — mostra exatamente o que a alteração faz e mais nada.
test('a consulta que se move não bloqueia as alternativas à volta dela', async () => {
  const id = await marcar({ daysAhead: 6, startTime: '10:00' });
  const apt = await queryOne(`SELECT appt_date::text AS d FROM appointments WHERE id=$1`, [id]);
  const dia = String(apt?.d);

  const params = {
    tenantId: tenantAId,
    type: 'Consulta de Avaliação',
    duration: 45,
    preferredDentistId: dentistId,
    fromDate: dia,
    days: 1,
    limit: 50,
  };

  const comOcupacao = await suggestAppointmentSlots(params);
  const semOcupacao = await suggestAppointmentSlots({ ...params, excludeAppointmentId: id });

  const horas = (r: { slots: Array<{ startTime: string }> }) => r.slots.map((s) => s.startTime);
  const bloqueadas = horas(comOcupacao);
  const libertadas = horas(semOcupacao);

  // A consulta ocupa as 10:00–10:45 e a nova também dura 45 minutos, por isso o último
  // início possível ANTES dela é 09:15 (acaba exatamente às 10:00) e o primeiro DEPOIS é
  // 10:45. A janela estritamente entre os dois é a que a ocupação da própria consulta
  // fecha — e é a única coisa que a exclusão muda.
  const dentroDoBloco = (h: string) => h > '09:15' && h < '10:45';

  assert.equal(
    bloqueadas.some(dentroDoBloco),
    false,
    `sem a exclusão, a janela à volta da consulta está fechada — deu ${bloqueadas.join(', ')}`,
  );
  assert.ok(
    libertadas.some(dentroDoBloco),
    `com a exclusão, essa janela devia abrir — deu ${libertadas.join(', ')}`,
  );
  // E a exclusão não inventa horários fora do bloco: tudo o que já estava continua lá.
  assert.ok(bloqueadas.every((h) => libertadas.includes(h)));
});

test('remarcar move a consulta e carimba rescheduled_at', async () => {
  const id = await marcar();
  const antes = await queryOne(`SELECT appt_date::text AS d, rescheduled_at FROM appointments WHERE id=$1`, [id]);
  assert.equal(antes?.rescheduled_at, null);

  const res = await remarcarPost(
    authedRequest(admin, {
      method: 'POST',
      url: `http://t/api/appointments/${id}/reschedule`,
      body: { date: novaData(12), startTime: '15:00' },
    }),
    ctx(id),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(String(body.to), /15:00/);

  const depois = await queryOne(
    `SELECT appt_date::text AS d, start_time::text AS t, rescheduled_at FROM appointments WHERE id=$1`,
    [id],
  );
  assert.equal(String(depois?.d), novaData(12));
  assert.match(String(depois?.t), /^15:00/);
  assert.ok(depois?.rescheduled_at, 'rescheduled_at devia ficar carimbado');
});

function novaData(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}

// A verificação que o PUT de edição nunca teve: mudar a data à mão podia sobrepor duas
// consultas na mesma cadeira sem aviso nenhum.
test('remarcar para cima de outra consulta é recusado com 409', async () => {
  const ocupada = await marcar({ daysAhead: 20, startTime: '09:00', chair: 1 });
  const mover = await marcar({ daysAhead: 21, startTime: '09:00', chair: 1 });
  const alvo = await queryOne(`SELECT appt_date::text AS d FROM appointments WHERE id=$1`, [ocupada]);

  const res = await remarcarPost(
    authedRequest(admin, {
      method: 'POST',
      url: `http://t/api/appointments/${mover}/reschedule`,
      body: { date: String(alvo?.d), startTime: '09:15', chair: 1 },
    }),
    ctx(mover),
  );
  assert.equal(res.status, 409);

  // E não mexeu em nada.
  const depois = await queryOne(`SELECT rescheduled_at FROM appointments WHERE id=$1`, [mover]);
  assert.equal(depois?.rescheduled_at, null);
});

// Mover um 'departed' reescreveria a história administrativa da clínica.
test('uma consulta já realizada não se remarca', async () => {
  const id = await marcar({ daysAhead: -2, status: 'departed' });
  const res = await remarcarPost(
    authedRequest(admin, {
      method: 'POST',
      url: `http://t/api/appointments/${id}/reschedule`,
      body: { date: novaData(9), startTime: '11:00' },
    }),
    ctx(id),
  );
  assert.equal(res.status, 409);
});

test('uma data ou hora malformada é recusada com 400', async () => {
  const id = await marcar();
  for (const body of [{ date: 'amanhã', startTime: '10:00' }, { date: novaData(5), startTime: '25h' }, {}]) {
    const res = await remarcarPost(
      authedRequest(admin, { method: 'POST', url: `http://t/api/appointments/${id}/reschedule`, body }),
      ctx(id),
    );
    assert.equal(res.status, 400, `${JSON.stringify(body)} devia ser recusado`);
  }
});

// ─── O PUT de edição ────────────────────────────────────────────────────────
// Não fazia parte do fluxo de remarcação, mas vive na mesma agenda e tinha o buraco que
// este ficheiro existe para tapar: mudar a data à mão não verificava sobreposição
// nenhuma. Dois doentes na mesma cadeira à mesma hora, sem erro, descoberto na sala de
// espera. Agora as três rotas partilham claimSlot (lib/scheduling.ts).

test('editar uma consulta para cima de outra é recusado com 409', async () => {
  const ocupada = await marcar({ daysAhead: 30, startTime: '09:00', chair: 1 });
  const mover = await marcar({ daysAhead: 31, startTime: '09:00', chair: 1 });
  const alvo = await queryOne(`SELECT appt_date::text AS d FROM appointments WHERE id=$1`, [ocupada]);

  const res = await editarPut(
    authedRequest(admin, {
      method: 'PUT',
      url: `http://t/api/appointments/${mover}`,
      body: { date: String(alvo?.d), startTime: '09:15', chair: 1 },
    }),
    ctx(mover),
  );
  assert.equal(res.status, 409);

  const depois = await queryOne(`SELECT appt_date::text AS d FROM appointments WHERE id=$1`, [mover]);
  assert.notEqual(String(depois?.d), String(alvo?.d), 'não devia ter mexido em nada');
});

// O outro lado da mesma moeda: editar sem mexer no lugar não pode ser travado pela
// própria consulta, nem avisar o doente de uma remarcação que não houve.
test('editar só as notas não colide consigo própria nem carimba remarcação', async () => {
  const id = await marcar({ daysAhead: 33, startTime: '11:00' });

  const res = await editarPut(
    authedRequest(admin, { method: 'PUT', url: `http://t/api/appointments/${id}`, body: { notes: 'trouxe o cartão' } }),
    ctx(id),
  );
  assert.equal(res.status, 200);

  const depois = await queryOne(`SELECT notes, rescheduled_at FROM appointments WHERE id=$1`, [id]);
  assert.equal(String(depois?.notes), 'trouxe o cartão');
  assert.equal(depois?.rescheduled_at, null, 'corrigir uma nota não é remarcar');
});

test('editar a data carimba rescheduled_at, para o doente ser avisado', async () => {
  const id = await marcar({ daysAhead: 35, startTime: '11:00' });

  const res = await editarPut(
    authedRequest(admin, {
      method: 'PUT',
      url: `http://t/api/appointments/${id}`,
      body: { date: novaData(36), startTime: '16:00' },
    }),
    ctx(id),
  );
  assert.equal(res.status, 200);

  const depois = await queryOne(`SELECT rescheduled_at FROM appointments WHERE id=$1`, [id]);
  assert.ok(depois?.rescheduled_at, 'sem isto a mudança de data nunca chegava ao doente');
});
