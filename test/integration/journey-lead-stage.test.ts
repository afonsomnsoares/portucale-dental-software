// O Lead como primeira etapa da jornada (lib/patientJourneyCalc.ts + computeJourneyPipeline).
//
// O quadro já desenhava uma coluna de leads, mas a partir de uma lista à parte: o
// catálogo de etapas começava em «Marcação» e a contagem era o comprimento de uma lista
// truncada. Duas coisas que só a base de dados mostra — que a etapa é povoada mesmo, e
// que a contagem deixa de mentir acima do limite — vivem aqui.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { computeJourneyPipeline } from '../../lib/patientJourney.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
const RUN = crypto.randomUUID();
const PREFIXO = `Lead jornada ${RUN.slice(0, 8)}`;

async function limpar() {
  await query(`DELETE FROM leads WHERE tenant_id=$1 AND name LIKE 'Lead jornada %'`, [tenantAId]);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  await limpar();
});

after(async () => {
  await limpar();
  await closeTestDb();
});

async function etapaLead() {
  const { stages } = await computeJourneyPipeline(tenantAId);
  const lead = stages.find((s) => s.key === 'lead');
  assert.ok(lead, 'a etapa lead devia existir no pipeline');
  return lead;
}

test('a jornada começa no Lead', async () => {
  const { stages } = await computeJourneyPipeline(tenantAId);
  assert.equal(stages[0].key, 'lead');
  assert.equal(stages[0].label, 'Lead');
});

test('um lead aberto aparece na primeira etapa, com a origem', async () => {
  await query(`INSERT INTO leads (tenant_id, name, phone, source, status) VALUES ($1,$2,'912000111','Instagram','open')`, [
    tenantAId,
    `${PREFIXO} A`,
  ]);

  const lead = await etapaLead();
  const meu = lead.patients.find((p) => p.name === `${PREFIXO} A`);
  assert.ok(meu, 'o lead devia estar na etapa');
  assert.equal(meu.isLead, true);
  assert.equal(meu.source, 'Instagram');
  // A próxima ação de um lead não se calcula a partir de sinais de doente: é sempre a
  // mesma, e é a única coisa que se pode fazer com ele.
  assert.equal(meu.next_action.code, 'respond_lead');
});

test('um lead convertido sai da etapa — já é doente', async () => {
  await query(
    `INSERT INTO leads (tenant_id, name, phone, status) VALUES ($1,$2,'912000222','converted')`,
    [tenantAId, `${PREFIXO} B`],
  );
  const lead = await etapaLead();
  assert.equal(
    lead.patients.some((p) => p.name === `${PREFIXO} B`),
    false,
  );
});

// O bug concreto que a unificação corrige: a contagem era `data.leads.length`, e a lista
// vinha com LIMIT 50. Uma clínica com mais leads abertos do que isso lia «50» no topo do
// funil — que é exatamente o número que se consulta esta página para saber.
test('a contagem é a verdadeira, mesmo acima do limite da lista', async () => {
  const antes = (await etapaLead()).count;

  const valores = Array.from({ length: 55 }, (_, i) => `('${tenantAId}','${PREFIXO} N${i}','91300${String(i).padStart(4, '0')}','open')`);
  await query(`INSERT INTO leads (tenant_id, name, phone, status) VALUES ${valores.join(',')}`);

  const lead = await etapaLead();
  assert.equal(lead.count, antes + 55, 'a contagem tem de contar todos');
  assert.ok(lead.patients.length <= 50, 'a lista continua truncada, que é o que se quer');
  assert.ok(lead.count > lead.patients.length, 'e a contagem passa à frente do comprimento da lista');
});
