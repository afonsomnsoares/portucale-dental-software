import { perHour } from './costingCalc';
import { query, queryOne, queryRead, withSystemContext } from './db';
import { computeForecasts } from './forecast';
import {
  aggregateForecast,
  type CapacityImbalance,
  type ClinicCapacity,
  canOfferAcrossClinics,
  findImbalances,
  freeMinutes,
  imbalanceValueEur,
  occupancy,
  spareCapacity,
  unmetDemand,
  weightedRate,
} from './groupCalc';

// ─── O nível de grupo ───────────────────────────────────────────────────────
// Liga lib/groupCalc.ts a linhas reais, e é o único sítio que lê VÁRIAS clínicas na
// mesma função. Tudo aqui corre dentro de withSystemContext: o RLS (migração 011) isola
// por tenant_id, e é suposto isolar — este ficheiro é a excepção declarada, e existe
// separado por isso. Uma leitura entre clínicas que aconteça por acidente dentro de uma
// rota de clínica é uma fuga; aqui é a funcionalidade.
//
// Nada do que está aqui é visível a uma clínica. As rotas que o servem exigem
// super_admin, pela mesma razão que os insights do agente Grupo ficam com tenant_id NULL
// (migração 041): uma unidade nunca lê o que o grupo sabe das outras.

/** O nome do consentimento que o doente dá para ser contactado por outra unidade. */
export const GROUP_TRANSFER_CONSENT = 'group_transfer';

const HORIZON_DAYS = 14;

export interface GroupClinic {
  tenantId: string;
  name: string;
  city: string;
  operatories: number;
  transfersEnabled: boolean;
  transfersBasis: string;
}

export async function listGroupClinics(): Promise<GroupClinic[]> {
  const rows = await queryRead(
    `SELECT id, name, city, operatories, group_transfers_enabled, COALESCE(group_transfers_basis,'') AS basis
       FROM tenants WHERE status='active' ORDER BY name`,
  );
  return rows.map((r) => ({
    tenantId: String(r.id),
    name: String(r.name),
    city: String(r.city || ''),
    operatories: Math.max(1, Number(r.operatories) || 1),
    transfersEnabled: !!r.group_transfers_enabled,
    transfersBasis: String(r.basis || ''),
  }));
}

// ─── 1. Capacidade e procura, por unidade ───────────────────────────────────
// Livre = capacidade teórica do horizonte menos o que já está marcado. Teórica e não
// «horas de turno declaradas» de propósito: nem todas as clínicas têm staff_schedules
// preenchido, e uma que não tenha apareceria com zero capacidade e nunca receberia
// ninguém — o pior tipo de erro, porque é silencioso e enviesa sempre para o mesmo lado.
const WORK_MINUTES_PER_DAY = 8 * 60;

async function capacityFor(clinic: GroupClinic, days: number): Promise<ClinicCapacity> {
  const [marcado, espera] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(duration),0)::int AS minutos
         FROM appointments
        WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE
          AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
          AND status NOT IN ('no-show','departed')`,
      [clinic.tenantId, days],
    ),
    queryOne(
      `SELECT COALESCE(SUM(min_duration),0)::int AS minutos, COUNT(*)::int AS doentes
         FROM waitlist_entries WHERE tenant_id=$1 AND status='active'`,
      [clinic.tenantId],
    ),
  ]);

  return {
    tenantId: clinic.tenantId,
    name: clinic.name,
    bookedMinutes: Number(marcado?.minutos || 0),
    capacityMinutes: clinic.operatories * WORK_MINUTES_PER_DAY * days,
    waitingMinutes: Number(espera?.minutos || 0),
    waitingPatients: Number(espera?.doentes || 0),
  };
}

// ─── 2. Quem é que se pode mesmo mover ──────────────────────────────────────
// A conta dos minutos não sabe nada de pessoas. Esta diz, para cada desequilíbrio, quem
// da lista de espera da origem é elegível — e, quando não é, porquê. A razão vai para o
// ecrã: «não podemos fazer isto» e «não sabemos que isto existe» levam a acções
// diferentes, e só a primeira é uma decisão que alguém pode tomar.
export interface TransferCandidate {
  patientId: string;
  name: string;
  treatmentType: string;
  minDuration: number;
  eligible: boolean;
  reason: string;
}

async function transferCandidatesFor(
  imbalance: CapacityImbalance,
  origem: GroupClinic,
  limit = 10,
): Promise<TransferCandidate[]> {
  const rows = await queryRead(
    `SELECT w.patient_id, w.treatment_type, w.min_duration, p.name,
            EXISTS (
              SELECT 1 FROM patient_data_consents c
               WHERE c.patient_id = w.patient_id AND c.consent_type = $2
                 AND c.given = TRUE AND c.revoked_at IS NULL
            ) AS consentiu
       FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id
      WHERE w.tenant_id=$1 AND w.status='active'
      -- Quem consentiu primeiro, e só depois por tempo de espera. Ordenar só por espera
      -- parece justo e não é útil: numa lista de trinta pessoas em que três consentiram,
      -- as dez primeiras podem não incluir nenhuma delas, e o ecrã mostra dez nomes sobre
      -- os quais não se pode fazer nada enquanto esconde os três sobre os quais se pode.
      ORDER BY consentiu DESC, w.created_at
      LIMIT $3`,
    [imbalance.fromTenantId, GROUP_TRANSFER_CONSENT, limit],
  );

  return rows.map((r) => {
    const pode = canOfferAcrossClinics({
      clinicAllowsTransfers: origem.transfersEnabled,
      patientConsented: !!r.consentiu,
    });
    return {
      patientId: String(r.patient_id),
      name: String(r.name),
      treatmentType: String(r.treatment_type),
      minDuration: Number(r.min_duration) || 30,
      eligible: pode.ok,
      reason: pode.reason,
    };
  });
}

// ─── 3. Recursos e equipa, entre unidades ───────────────────────────────────
// A mesma pergunta que cada clínica já responde para si, feita ao grupo: o que é que
// existe, onde, e o que está parado. O valor não está em nenhuma linha isolada — está em
// ver a coluna toda: um aparelho avariado numa unidade e dois parados noutra é uma
// conversa que nunca acontece enquanto cada uma só vir a sua.
export interface GroupEquipmentRow {
  tenantId: string;
  clinic: string;
  name: string;
  tags: string[];
  status: string;
  available: boolean;
}

export interface GroupStaffRow {
  tenantId: string;
  clinic: string;
  userId: string;
  name: string;
  role: string;
  specialties: string[];
  /** Minutos de turno declarados por semana — zero significa sem horário definido. */
  weeklyMinutes: number;
}

async function groupEquipment(clinics: GroupClinic[]): Promise<GroupEquipmentRow[]> {
  const out: GroupEquipmentRow[] = [];
  for (const c of clinics) {
    const rows = await queryRead(
      `SELECT name, tags, status, active FROM clinic_equipment WHERE tenant_id=$1 ORDER BY name`,
      [c.tenantId],
    );
    for (const r of rows) {
      out.push({
        tenantId: c.tenantId,
        clinic: c.name,
        name: String(r.name),
        tags: Array.isArray(r.tags) ? (r.tags as string[]).map(String) : [],
        status: String(r.status),
        available: !!r.active && String(r.status) === 'operational',
      });
    }
  }
  return out;
}

async function groupStaff(clinics: GroupClinic[]): Promise<GroupStaffRow[]> {
  const out: GroupStaffRow[] = [];
  for (const c of clinics) {
    const rows = await queryRead(
      `SELECT u.id, u.name, u.role, u.specialties,
              COALESCE((
                SELECT SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60)::int
                  FROM staff_schedules s WHERE s.user_id = u.id
              ), 0) AS weekly_minutes
         FROM users u
        WHERE u.tenant_id=$1 AND u.active = TRUE AND u.role IN ('dentist','receptionist','admin')
        ORDER BY u.role, u.name`,
      [c.tenantId],
    );
    for (const r of rows) {
      out.push({
        tenantId: c.tenantId,
        clinic: c.name,
        userId: String(r.id),
        name: String(r.name),
        role: String(r.role),
        specialties: Array.isArray(r.specialties) ? (r.specialties as string[]).map(String) : [],
        weeklyMinutes: Number(r.weekly_minutes) || 0,
      });
    }
  }
  return out;
}

// Especialidades que existem numa unidade e não noutra — a leitura acionável de tudo o
// que está acima, e a que responde à pergunta «porque é que Lisboa não consegue absorver
// isto?». Sem ela o ecrã é uma lista de pessoas.
export function specialtyGaps(staff: GroupStaffRow[], clinics: GroupClinic[]) {
  const todas = new Set(staff.flatMap((s) => s.specialties));
  return clinics
    .map((c) => {
      const naUnidade = new Set(staff.filter((s) => s.tenantId === c.tenantId).flatMap((s) => s.specialties));
      return { tenantId: c.tenantId, clinic: c.name, missing: [...todas].filter((e) => !naUnidade.has(e)).sort() };
    })
    .filter((x) => x.missing.length > 0);
}

// ─── 4. Campanhas ───────────────────────────────────────────────────────────
// Não é um sistema de campanhas — é o que falta para uma poder ser coordenada de uma vez
// em vez de cinco vezes: quem está dormente em cada unidade, segmentado como o ecrã de
// reactivação de cada clínica já segmenta, somado ao nível do grupo. O envio continua a
// ser o de sempre, por clínica, com o consentimento de sempre.
export interface GroupCampaignAudience {
  tenantId: string;
  clinic: string;
  dormant: number;
  dormantHighValue: number;
  consentedForOutreach: number;
}

async function campaignAudience(clinics: GroupClinic[]): Promise<GroupCampaignAudience[]> {
  const out: GroupCampaignAudience[] = [];
  for (const c of clinics) {
    const row = await queryOne(
      `SELECT
         COUNT(*) FILTER (WHERE ls.stage = 'inactive')::int AS dormant,
         COUNT(*) FILTER (
           WHERE ls.stage = 'inactive'
             AND (SELECT COALESCE(SUM(paid),0) FROM invoices i WHERE i.patient_id = p.id) >= 500
         )::int AS dormant_high_value,
         COUNT(*) FILTER (
           WHERE ls.stage = 'inactive' AND EXISTS (
             SELECT 1 FROM patient_data_consents pc
              WHERE pc.patient_id = p.id AND pc.consent_type = 'marketing_outreach'
                AND pc.given = TRUE AND pc.revoked_at IS NULL
           )
         )::int AS consented
       FROM patients p
       JOIN patient_lifecycle_state ls ON ls.patient_id = p.id AND ls.tenant_id = p.tenant_id
      WHERE p.tenant_id=$1 AND p.status <> 'anonymized'`,
      [c.tenantId],
    );
    out.push({
      tenantId: c.tenantId,
      clinic: c.name,
      dormant: Number(row?.dormant || 0),
      dormantHighValue: Number(row?.dormant_high_value || 0),
      // O número que interessa a quem planeia uma campanha: os outros dois são o
      // universo, este é a audiência que se pode mesmo contactar.
      consentedForOutreach: Number(row?.consented || 0),
    });
  }
  return out;
}

// ─── 5. Previsão do grupo ───────────────────────────────────────────────────
async function groupForecast(clinics: GroupClinic[], days: number) {
  const porClinica = await Promise.all(
    clinics.map(async (c) => ({ clinic: c, forecasts: await computeForecasts(c.tenantId, days) })),
  );

  const serie = (metric: 'revenue' | 'demand' | 'cancellations' | 'noShows') =>
    porClinica.map(({ clinic, forecasts }) => {
      const m = forecasts.forecasts.find((x) => x.metric === metric);
      return { tenantId: clinic.tenantId, name: clinic.name, value: Number(m?.total || 0), reliable: !!m?.reliable };
    });

  return {
    horizonDays: days,
    revenue: aggregateForecast(serie('revenue')),
    demand: aggregateForecast(serie('demand')),
    cancellations: aggregateForecast(serie('cancellations')),
    noShows: aggregateForecast(serie('noShows')),
    // Ponderada e não a média das taxas: uma unidade com trinta consultas não pode pesar
    // o mesmo que uma com trezentas. Ver weightedRate.
    noShowRate: weightedRate(
      porClinica.map(({ forecasts }) => ({
        numerator: Number(forecasts.forecasts.find((x) => x.metric === 'noShows')?.total || 0),
        denominator: Number(forecasts.forecasts.find((x) => x.metric === 'demand')?.total || 0),
      })),
    ),
  };
}

// ─── O relatório inteiro ────────────────────────────────────────────────────
export async function computeGroupView(days = HORIZON_DAYS) {
  return withSystemContext(async () => {
    const clinics = await listGroupClinics();
    if (clinics.length < 2) {
      return { clinics, imbalances: [], equipment: [], staff: [], specialtyGaps: [], campaigns: [], forecast: null };
    }

    const capacities = await Promise.all(clinics.map((c) => capacityFor(c, days)));
    const desequilibrios = findImbalances(capacities);

    // Receita por hora de cadeira da unidade que recebe, para pôr o desequilíbrio em
    // euros. A mesma conta de computeMarginReport, feita sobre o último mês.
    const hoje = new Date().toLocaleDateString('en-CA');
    const mesPassado = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA');
    const receitaHora = new Map<string, number | null>();
    for (const c of clinics) {
      const row = await queryOne(
        `SELECT COALESCE(SUM(i.amount),0)::numeric AS receita, COALESCE(SUM(a.duration),0)::int AS minutos
           FROM appointments a
           LEFT JOIN invoices i ON i.appointment_id = a.id AND i.status <> 'cancelled'
          WHERE a.tenant_id=$1 AND a.appt_date BETWEEN $2::date AND $3::date AND a.status='departed'`,
        [c.tenantId, mesPassado, hoje],
      );
      receitaHora.set(c.tenantId, perHour(Number(row?.receita || 0), Number(row?.minutos || 0)));
    }

    const porId = new Map(clinics.map((c) => [c.tenantId, c]));
    const imbalances = await Promise.all(
      desequilibrios.map(async (d) => ({
        ...d,
        valueEur: imbalanceValueEur(d.movableMinutes, receitaHora.get(d.toTenantId) ?? null),
        candidates: await transferCandidatesFor(d, porId.get(d.fromTenantId) as GroupClinic),
      })),
    );

    const [equipment, staff, campaigns, forecast] = await Promise.all([
      groupEquipment(clinics),
      groupStaff(clinics),
      campaignAudience(clinics),
      groupForecast(clinics, days),
    ]);

    return {
      clinics,
      capacities: capacities.map((c) => ({
        ...c,
        occupancy: occupancy(c),
        free: freeMinutes(c),
        unmet: unmetDemand(c),
        spare: spareCapacity(c),
      })),
      imbalances,
      equipment,
      staff,
      specialtyGaps: specialtyGaps(staff, clinics),
      campaigns,
      forecast,
    };
  });
}

/** Ligar ou desligar a porta legal de uma unidade. Só o super-admin lá chega. */
export async function setTransferPolicy(tenantId: string, enabled: boolean, basis: string, userId: string | null) {
  const [row] = await query(
    `UPDATE tenants
        SET group_transfers_enabled=$2,
            group_transfers_basis=$3,
            group_transfers_enabled_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            group_transfers_enabled_by = CASE WHEN $2 THEN $4::uuid ELSE NULL END
      WHERE id=$1
      RETURNING id, name, group_transfers_enabled, group_transfers_basis`,
    [tenantId, enabled, basis.slice(0, 2000), userId],
  );
  return row || null;
}
