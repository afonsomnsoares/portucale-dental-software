// Duas portas que só existem contra a base de dados:
//
//   • a OFERTA de vaga, que passou a perguntar se a clínica consegue mesmo fazer aquele
//     tratamento hoje antes de contactar ninguém (lib/waitlist.ts);
//   • o LIMIAR de inatividade, que deixou de ser uma constante e passou a ser uma coluna
//     da clínica (migração 060) — e o que interessa testar é que os dois sítios que o
//     leem, ciclo de vida e recuperação, leem o mesmo.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET as settingsGet, PUT as settingsPut } from '../../app/api/lifecycle/settings/route.ts';
import { query, queryOne } from '../../lib/db.ts';
import { computeLifecycleTransitions, inactiveAfterMonths } from '../../lib/lifecycle.ts';
import { notifyWaitlistOfFreedSlot } from '../../lib/waitlist.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getOrCreateTenantAdmin, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
let admin: Awaited<ReturnType<typeof getOrCreateTenantAdmin>>;
const RUN = crypto.randomUUID();
let seq = 0;

async function doente(over: { lastVisit?: string; visitCount?: number } = {}) {
  seq += 1;
  const phone = `94${String(seq).padStart(3, '0')}${RUN.replace(/\D/g, '').slice(0, 4).padEnd(4, '0')}`;
  const [row] = await query(
    `INSERT INTO patients (tenant_id, name, phone, comm_prefs, visit_count, last_visit)
     VALUES ($1,$2,$3,'{}'::jsonb,$4,$5::date) RETURNING id`,
    [
      tenantAId,
      `Limiar ${seq} (${RUN.slice(0, 8)})`,
      phone.slice(0, 9),
      over.visitCount ?? 2,
      over.lastVisit ?? null,
    ],
  );
  return String(row.id);
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  admin = await getOrCreateTenantAdmin(tenantAId, 'Clínica Portucale');
});

after(async () => {
  // Deixar o limiar como estava: outros ficheiros da suite leem a coorte de inativos.
  await query(`UPDATE tenants SET inactive_after_months=6 WHERE id=$1`, [tenantAId]);
  await closeTestDb();
});

// ─── A vaga só se oferece se a clínica a conseguir cumprir ──────────────────

test('sem o equipamento exigido, a vaga não é oferecida a ninguém', async () => {
  const p = await doente();
  // Uma pessoa na lista de espera que casaria perfeitamente com a vaga: mesmo
  // tratamento, sem preferências nenhumas. Se a oferta não sair, é pelo equipamento.
  await query(
    `INSERT INTO waitlist_entries (tenant_id, patient_id, treatment_type, min_duration, status)
     VALUES ($1,$2,'Endodontia',60,'active')`,
    [tenantAId, p],
  );

  // Endodontia exige 'endo_motor' (lib/constants.ts). Garantir que a cadeira 1 não o tem
  // operacional — é exatamente o cenário da avaria da manhã.
  await query(
    `UPDATE clinic_equipment SET status='broken'
      WHERE tenant_id=$1 AND 'endo_motor' = ANY(tags)`,
    [tenantAId],
  );

  const r = await notifyWaitlistOfFreedSlot(
    tenantAId,
    { date: '2099-01-05', startTime: '10:00', type: 'Endodontia', duration: 60, dentistId: null, chair: 1 },
    null,
  );

  assert.equal(r.offered, 0);
  assert.deepEqual((r as { blockedByEquipment?: string[] }).blockedByEquipment, ['endo_motor']);

  const ofertas = await query(`SELECT id FROM slot_offers WHERE tenant_id=$1 AND offered_date='2099-01-05'`, [
    tenantAId,
  ]);
  assert.equal(ofertas.length, 0, 'não devia ter contactado ninguém');
});

// O reverso, para o teste acima não passar por a lista de espera estar simplesmente vazia.
test('com o equipamento operacional, a mesma vaga é oferecida', async () => {
  const p = await doente();
  await query(
    `INSERT INTO waitlist_entries (tenant_id, patient_id, treatment_type, min_duration, status)
     VALUES ($1,$2,'Endodontia',60,'active')`,
    [tenantAId, p],
  );
  await query(
    `INSERT INTO clinic_equipment (tenant_id, name, chair, tags, active, status)
     VALUES ($1,'Motor endo (teste)',2,ARRAY['endo_motor'],TRUE,'operational')`,
    [tenantAId],
  );

  const r = await notifyWaitlistOfFreedSlot(
    tenantAId,
    { date: '2099-01-06', startTime: '10:00', type: 'Endodontia', duration: 60, dentistId: null, chair: 2 },
    null,
  );

  assert.ok(r.offered > 0, 'a vaga devia ter sido oferecida');
});

// Um tratamento sem exigências não pode ficar bloqueado por um catálogo de equipamento
// vazio — é a esmagadora maioria das consultas.
test('um tratamento sem exigências de equipamento é sempre oferecível', async () => {
  const p = await doente();
  await query(
    `INSERT INTO waitlist_entries (tenant_id, patient_id, treatment_type, min_duration, status)
     VALUES ($1,$2,'Extração',30,'active')`,
    [tenantAId, p],
  );

  const r = await notifyWaitlistOfFreedSlot(
    tenantAId,
    { date: '2099-01-07', startTime: '10:00', type: 'Extração', duration: 30, dentistId: null, chair: 1 },
    null,
  );
  assert.ok(r.offered > 0);
});

// ─── O limiar de inatividade ────────────────────────────────────────────────

test('o limiar guardado é o que o ciclo de vida passa a usar', async () => {
  // Nove meses sem aparecer: inativo a 6, ativo a 12.
  const p = await doente({ lastVisit: new Date(Date.now() - 275 * 86400000).toISOString().slice(0, 10) });

  await query(`UPDATE tenants SET inactive_after_months=6 WHERE id=$1`, [tenantAId]);
  const comSeis = await computeLifecycleTransitions(tenantAId);
  const aSeis = await queryOne(`SELECT stage FROM patient_lifecycle_state WHERE patient_id=$1`, [p]);
  assert.equal(String(aSeis?.stage), 'inactive');
  assert.ok(comSeis.transitions.length >= 0);

  await query(`UPDATE tenants SET inactive_after_months=12 WHERE id=$1`, [tenantAId]);
  await computeLifecycleTransitions(tenantAId);
  const aDoze = await queryOne(`SELECT stage FROM patient_lifecycle_state WHERE patient_id=$1`, [p]);
  assert.equal(String(aDoze?.stage), 'stable', 'nove meses não chega a doze');
});

test('a rota grava o limiar e devolve as etapas já com ele', async () => {
  const res = await settingsPut(
    authedRequest(admin, { method: 'PUT', url: 'http://t/api/lifecycle/settings', body: { inactiveMonths: 3 } }),
    { params: Promise.resolve({}) } as never,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.inactiveMonths, 3);
  const inativa = (body.stages as Array<{ key: string; description: string }>).find((s) => s.key === 'inactive');
  assert.match(String(inativa?.description), /3 meses/);

  assert.equal(await inactiveAfterMonths(tenantAId), 3);
});

// O CHECK da migração 060 existe porque os dois extremos partem coisas em silêncio: a
// zero, toda a gente fica permanentemente inativa. A rota tem de recusar antes da base,
// senão o utilizador vê um 500 em vez de saber o que escrever.
test('um limiar fora dos limites é recusado com 400, não com 500', async () => {
  for (const valor of [0, 61, 2.5, 'seis']) {
    const res = await settingsPut(
      authedRequest(admin, {
        method: 'PUT',
        url: 'http://t/api/lifecycle/settings',
        body: { inactiveMonths: valor },
      }),
      { params: Promise.resolve({}) } as never,
    );
    assert.equal(res.status, 400, `${valor} devia ser recusado`);
  }
});

test('o GET devolve o valor em vigor e os limites', async () => {
  const res = await settingsGet(
    authedRequest(admin, { url: 'http://t/api/lifecycle/settings' }),
    { params: Promise.resolve({}) } as never,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.inactiveMonths, 3);
  assert.equal(body.min, 1);
  assert.equal(body.max, 60);
  assert.equal(body.defaultMonths, 6);
});
