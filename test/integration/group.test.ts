// O nível de grupo (migração 063).
//
// Integração por duas razões distintas, e a segunda é a que importa:
//   • as contas atravessam clínicas, e só a base de dados tem mais do que uma;
//   • este é o ÚNICO ficheiro do produto que lê várias clínicas de propósito. O RLS
//     (migração 011) existe para o impedir em todo o lado; aqui é a excepção declarada.
//     Um teste que confirme que a excepção funciona vale pouco — o que vale é confirmar
//     que ela não vaza para as rotas de clínica, e que a porta legal está fechada.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as grupoGet } from '../../app/api/platform/group/route.ts';
import { PUT as transferenciasPut } from '../../app/api/platform/group/transfers/route.ts';
import { query, queryOne } from '../../lib/db.ts';
import { computeGroupView, GROUP_TRANSFER_CONSENT } from '../../lib/group.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getOrCreateTenantAdmin, getTenantAId, getTenantBId } from '../helpers/testDb.ts';

let tenantAId: string;
let tenantBId: string;
let superAdmin: { id: string; name: string; role: string; clinic: string | null; tenantId: string | null };
let clinicAdmin: Awaited<ReturnType<typeof getOrCreateTenantAdmin>>;
const RUN = crypto.randomUUID();
const ctx = () => ({ params: Promise.resolve({}) }) as never;

async function limpar() {
  for (const t of [tenantAId, tenantBId]) {
    const alvo = `SELECT id FROM patients WHERE tenant_id=$1 AND name LIKE 'Grupo %'`;
    await query(`DELETE FROM patient_data_consents WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [t]);
    await query(`DELETE FROM waitlist_entries WHERE tenant_id=$1 AND patient_id IN (${alvo})`, [t]);
    await query(`DELETE FROM patients WHERE tenant_id=$1 AND name LIKE 'Grupo %'`, [t]);
  }
  await query(`UPDATE tenants SET group_transfers_enabled=FALSE, group_transfers_basis='' WHERE id = ANY($1::uuid[])`, [
    [tenantAId, tenantBId],
  ]);
}

let seq = 0;
async function emEspera(tenantId: string, minutos = 45) {
  seq += 1;
  const [p] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
    [tenantId, `Grupo ${seq} (${RUN.slice(0, 8)})`, `90${String(seq).padStart(7, '0')}`.slice(0, 9)],
  );
  await query(
    `INSERT INTO waitlist_entries (tenant_id, patient_id, treatment_type, min_duration, status)
     VALUES ($1,$2,'Destartarização',$3,'active')`,
    [tenantId, p.id, minutos],
  );
  return String(p.id);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
  clinicAdmin = await getOrCreateTenantAdmin(tenantAId, 'Clínica Portucale');
  const row = await queryOne(`SELECT id, name FROM users WHERE role='super_admin' LIMIT 1`);
  superAdmin = { id: String(row?.id), name: String(row?.name), role: 'super_admin', clinic: null, tenantId: null };
  await limpar();
});

after(async () => {
  await limpar();
  await closeTestDb();
});

test('a vista de grupo vê mais do que uma clínica', async () => {
  const v = await computeGroupView(14);
  assert.ok(v.clinics.length >= 2, 'a semente tem duas clínicas');
  const nomes = v.clinics.map((c) => c.name);
  assert.ok(new Set(nomes).size === nomes.length, 'sem duplicados');
});

// ─── A porta legal ──────────────────────────────────────────────────────────

test('por omissão nenhuma clínica pode transferir doentes', async () => {
  const v = await computeGroupView(14);
  assert.ok(v.clinics.every((c) => !c.transfersEnabled), 'FALSE por omissão, e é para ficar');
});

// Encher a agenda de A até passar o limiar de ocupação. Sem isto a unidade tem folga e,
// por desenho, não pede ajuda nenhuma — ver BUSY_OCCUPANCY em lib/groupCalc.ts.
async function encherAgenda(tenantId: string, days: number) {
  const t = await queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]);
  const capacidade = Math.max(1, Number(t?.operatories) || 1) * 8 * 60 * days;
  const jaMarcado = await queryOne(
    `SELECT COALESCE(SUM(duration),0)::int AS m FROM appointments
      WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
        AND status NOT IN ('no-show','departed')`,
    [tenantId, days],
  );
  // Uma única linha com a duração que falta: o que se está a testar é a aritmética da
  // ocupação, não a agenda em si.
  const falta = Math.ceil(capacidade * 0.9) - Number(jaMarcado?.m || 0);
  if (falta <= 0) return;
  const [p] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs) VALUES ($1,'Grupo ocupação','900000999','{}'::jsonb) RETURNING id`,
    [tenantId],
  );
  await query(
    `INSERT INTO appointments (tenant_id, patient_id, chair, appt_date, start_time, duration, type, status)
     VALUES ($1,$2,1,CURRENT_DATE,'08:00',$3,'Consulta de Avaliação','confirmed')`,
    [tenantId, p.id, falta],
  );
}

test('com procura numa unidade e folga noutra, a oportunidade aparece mas não é acionável', async () => {
  // Procura a mais em A: muitas pessoas à espera, e a agenda cheia.
  for (let i = 0; i < 12; i++) await emEspera(tenantAId, 60);
  await encherAgenda(tenantAId, 14);

  const v = await computeGroupView(14);
  const d = v.imbalances.find((x) => x.fromTenantId === tenantAId);
  assert.ok(d, 'devia haver desequilíbrio a partir de A');
  assert.ok(d.movableMinutes > 0);
  assert.ok(d.candidates.length > 0, 'e nomes concretos de quem está à espera');
  // Nenhum é elegível: nem a clínica declarou base, nem os doentes consentiram.
  assert.ok(
    d.candidates.every((c) => !c.eligible),
    'a oportunidade vê-se, não se age sobre ela',
  );
  assert.match(String(d.candidates[0].reason), /base legal/);
});

test('ligar a porta exige declarar a base por escrito', async () => {
  const semBase = await transferenciasPut(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: 'http://t/api/platform/group/transfers',
      body: { tenantId: tenantAId, enabled: true, basis: '' },
    }),
    ctx(),
  );
  assert.equal(semBase.status, 400);

  const comBase = await transferenciasPut(
    authedRequest(superAdmin, {
      method: 'PUT',
      url: 'http://t/api/platform/group/transfers',
      body: { tenantId: tenantAId, enabled: true, basis: 'Consentimento recolhido no acto de inscrição — DPO 2026.' },
    }),
    ctx(),
  );
  assert.equal(comBase.status, 200);

  const t = await queryOne(
    `SELECT group_transfers_enabled, group_transfers_basis, group_transfers_enabled_at, group_transfers_enabled_by
       FROM tenants WHERE id=$1`,
    [tenantAId],
  );
  assert.equal(t?.group_transfers_enabled, true);
  assert.match(String(t?.group_transfers_basis), /DPO/);
  // Quem ligou e quando — a única resposta possível a «com que base fizeram isto?».
  assert.ok(t?.group_transfers_enabled_at);
  assert.ok(t?.group_transfers_enabled_by);
});

// A clínica ter base não chega: o doente tem de ter consentido. São condições sobre
// sujeitos diferentes e não se substituem.
test('com a clínica autorizada, só é elegível quem consentiu', async () => {
  const comConsentimento = await emEspera(tenantAId, 60);
  for (let i = 0; i < 11; i++) await emEspera(tenantAId, 60);
  await query(
    `INSERT INTO patient_data_consents (tenant_id, patient_id, consent_type, purpose, given)
     VALUES ($1,$2,$3,'Contacto por outra unidade do grupo',TRUE)`,
    [tenantAId, comConsentimento, GROUP_TRANSFER_CONSENT],
  );

  const v = await computeGroupView(14);
  const d = v.imbalances.find((x) => x.fromTenantId === tenantAId);
  assert.ok(d);
  const elegiveis = d.candidates.filter((c) => c.eligible);
  const naoElegiveis = d.candidates.filter((c) => !c.eligible);
  assert.ok(elegiveis.some((c) => c.patientId === comConsentimento), 'quem consentiu é elegível');
  assert.ok(naoElegiveis.length > 0, 'quem não consentiu continua a não ser');
  assert.match(String(naoElegiveis[0].reason), /consentiu/);
});

// ─── O isolamento não se parte ──────────────────────────────────────────────

test('um admin de clínica não chega à vista de grupo', async () => {
  const res = await grupoGet(authedRequest(clinicAdmin, { url: 'http://t/api/platform/group' }), ctx());
  assert.equal(res.status, 403, 'tenants:manage é acção de plataforma');
});

test('um admin de clínica não pode abrir a porta legal de ninguém', async () => {
  const res = await transferenciasPut(
    authedRequest(clinicAdmin, {
      method: 'PUT',
      url: 'http://t/api/platform/group/transfers',
      body: { tenantId: tenantBId, enabled: true, basis: 'tentativa a partir de uma clínica' },
    }),
    ctx(),
  );
  assert.equal(res.status, 403);
  const t = await queryOne(`SELECT group_transfers_enabled FROM tenants WHERE id=$1`, [tenantBId]);
  assert.equal(t?.group_transfers_enabled, false);
});

// ─── Os outros quatro itens ─────────────────────────────────────────────────

test('equipa, equipamento, campanhas e previsão vêm de todas as unidades', async () => {
  const v = await computeGroupView(14);
  const clinicasComEquipa = new Set(v.staff.map((s) => s.tenantId));
  assert.ok(clinicasComEquipa.size >= 1);
  assert.ok(Array.isArray(v.equipment));
  assert.equal(v.campaigns.length, v.clinics.length, 'uma linha de audiência por unidade');
  assert.ok(v.forecast, 'a previsão do grupo existe');
  assert.equal(v.forecast.revenue.contributors, v.clinics.length);
  // A taxa do grupo é ponderada ou null — nunca a média das taxas das unidades.
  assert.ok(v.forecast.noShowRate === null || (v.forecast.noShowRate >= 0 && v.forecast.noShowRate <= 1));
});
