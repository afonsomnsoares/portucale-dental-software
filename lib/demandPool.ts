import { loadTypeValues, type TypeValues, valueOfType } from './appointmentValue';
import { canAutoContact } from './commPrefs';
import {
  CHECKUP_APPOINTMENT_TYPE,
  FOLLOW_UP_APPOINTMENT_TYPE,
  getDefaultDuration,
  matchAppointmentType,
} from './constants';
import { query } from './db';
import type { DemandCandidate, DemandSource } from './demandPoolCalc';
import { riskScore } from './noShowRisk';
import { addDays } from './scheduling';
import { getPreferencesForPatients } from './schedulingPrefs';
import type { SchedulingPreferences } from './schedulingPrefsCalc';

// A metade da procura que lê a base de dados. As regras (o que encaixa onde, e
// quanto vale) estão em lib/demandPoolCalc.ts, puro e testado.
//
// A pergunta a que este ficheiro responde é: "quem, de toda a base, está à
// espera de vir à clínica?" — e a resposta NÃO é a lista de espera. A lista de
// espera é quem se inscreveu; isto é quem tem motivo. Os cinco sítios onde esse
// motivo já estava escrito e ninguém cruzava com um buraco na agenda estão
// documentados em lib/demandPoolCalc.ts.
//
// Nenhuma destas consultas inventa procura: todas leem uma decisão que alguém já
// tomou (inscreveu-se, aceitou um plano, marcou um recall, marcou consulta).

// O consentimento específico para contacto de reativação, o mesmo que
// lib/lifecycle.ts exige antes de mandar um SMS a um doente inativo.
const REACTIVATION_CONSENT_TYPE = 'marketing_outreach';
// Uma consulta a mais de uma semana é candidata a ser antecipada. Abaixo disto o
// doente já se organizou para o dia que tem, e o ganho de a puxar dois dias não
// paga o incómodo de lhe mexer nos planos.
const ADVANCE_MIN_DAYS_AHEAD = 7;
// Os tipos de notificação que contam para o intervalo mínimo entre contactos.
// Um lembrete da consulta de amanhã não é "ser incomodado" — é serviço — e não
// pode bloquear uma oferta.
const OUTREACH_KINDS = [
  'slot_offer',
  'dynamic_offer',
  'risk_outreach',
  'recall_reminder',
  'lifecycle_outreach',
  'plan_followup',
];

export interface DemandPool {
  candidates: DemandCandidate[];
  counts: Record<DemandSource, number>;
  warnings: string[];
  typeValues: TypeValues;
}

interface RawCandidate {
  source: DemandSource;
  sourceId: string;
  patientId: string;
  treatmentType: string;
  durationMinutes: number;
  valueEur: number;
  overdueDays: number;
  maxWaitUntil: string | null;
  entryPrefs: SchedulingPreferences | null;
  currentAppointmentId: string | null;
  currentAppointmentDate: string | null;
}

function daysSince(value: unknown, today: string): number {
  if (!value) return 0;
  const then = Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

export async function buildDemandPool(
  tenantId: string,
  opts: { horizonDays: number; sources: readonly string[] },
): Promise<DemandPool> {
  const today = new Date().toLocaleDateString('en-CA');
  const horizonEnd = addDays(today, Math.max(1, opts.horizonDays));
  const wants = (s: DemandSource) => opts.sources.includes(s);
  const warnings: string[] = [];
  const raw: RawCandidate[] = [];

  const typeValues = await loadTypeValues(tenantId);
  if (!typeValues.sampleSize) {
    warnings.push(
      'Ainda não há consultas com valor lançado — o critério económico não conta para a pontuação. ' +
        'Lançar o valor ao fechar a consulta torna-o disponível.',
    );
  }

  // ─── 1. Lista de espera ──────────────────────────────────────────────────
  // Quem pediu explicitamente para ser chamado. A única fonte com preferências
  // próprias (as da entrada, que podem ser mais específicas do que as do perfil
  // do doente).
  if (wants('waitlist')) {
    const rows = await query(
      `SELECT w.id, w.patient_id, w.treatment_type, w.min_duration, w.max_wait_until::text AS max_wait_until,
              w.preferred_dentist_id, w.preferred_days,
              w.preferred_time_start::text AS preferred_time_start,
              w.preferred_time_end::text AS preferred_time_end,
              w.created_at
         FROM waitlist_entries w
        WHERE w.tenant_id=$1 AND w.status='active'
        ORDER BY w.created_at`,
      [tenantId],
    );
    for (const r of rows) {
      const type = String(r.treatment_type || '');
      raw.push({
        source: 'waitlist',
        sourceId: String(r.id),
        patientId: String(r.patient_id),
        treatmentType: type,
        durationMinutes: Math.max(Number(r.min_duration) || 30, getDefaultDuration(type)),
        valueEur: valueOfType(typeValues, type),
        overdueDays: daysSince(r.created_at, today),
        maxWaitUntil: r.max_wait_until ? String(r.max_wait_until) : null,
        entryPrefs: {
          preferredDentistId: (r.preferred_dentist_id as string) || null,
          preferredDays: Array.isArray(r.preferred_days) ? (r.preferred_days as number[]).map(Number) : null,
          preferredTimeStart: r.preferred_time_start ? String(r.preferred_time_start).slice(0, 5) : null,
          preferredTimeEnd: r.preferred_time_end ? String(r.preferred_time_end).slice(0, 5) : null,
        },
        currentAppointmentId: null,
        currentAppointmentDate: null,
      });
    }
  }

  // ─── 2. Planos aceites e parados ─────────────────────────────────────────
  // O doente já disse que sim e ninguém marcou a sessão seguinte. É a mesma
  // condição do "accepted_open" de lib/recovery.ts — a diferença é que ali
  // vira dinheiro por recuperar num relatório, e aqui vira um telefonema.
  if (wants('treatment_open')) {
    const rows = await query(
      `SELECT t.id, t.patient_id, t.description, t.treatment_code, t.fee, t.updated_at, t.created_at
         FROM treatments t
        WHERE t.tenant_id=$1 AND t.status='accepted'
          AND NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.patient_id = t.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
          )
        ORDER BY t.updated_at`,
      [tenantId],
    );
    for (const r of rows) {
      // O tipo sai da descrição clínica quando ela nomeia um procedimento do
      // catálogo ("Endodontia do 26"); quando não nomeia — o caso normal — o
      // que se marca é uma consulta de acompanhamento, e é o dentista que
      // decide lá o que se faz.
      const type =
        matchAppointmentType(r.description) || matchAppointmentType(r.treatment_code) || FOLLOW_UP_APPOINTMENT_TYPE;
      // Aqui o valor não é uma estimativa: é o que está escrito no plano.
      const fee = Number(r.fee || 0);
      raw.push({
        source: 'treatment_open',
        sourceId: String(r.id),
        patientId: String(r.patient_id),
        treatmentType: type,
        durationMinutes: getDefaultDuration(type),
        valueEur: fee > 0 ? fee : valueOfType(typeValues, type),
        overdueDays: daysSince(r.updated_at || r.created_at, today),
        maxWaitUntil: null,
        entryPrefs: null,
        currentAppointmentId: null,
        currentAppointmentDate: null,
      });
    }
  }

  // ─── 3. Recalls vencidos ─────────────────────────────────────────────────
  // A periodicidade que o próprio doente aceitou quando a marcou. Inclui os que
  // vencem dentro do horizonte, não só os já vencidos: se há cadeira livre na
  // quinta e o recall vence na sexta, antecipá-lo um dia é melhor do que deixar
  // a cadeira vazia e mandar-lhe um SMS na semana seguinte.
  if (wants('recall_due')) {
    const rows = await query(
      `SELECT r.id, r.patient_id, r.recall_type, r.next_due::text AS next_due
         FROM recalls r
        WHERE r.tenant_id=$1 AND r.active = TRUE AND r.next_due IS NOT NULL
          AND r.next_due <= $2::date
          AND NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.patient_id = r.patient_id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
          )
        ORDER BY r.next_due`,
      [tenantId, horizonEnd],
    );
    for (const r of rows) {
      const type = matchAppointmentType(r.recall_type) || CHECKUP_APPOINTMENT_TYPE;
      raw.push({
        source: 'recall_due',
        sourceId: String(r.id),
        patientId: String(r.patient_id),
        treatmentType: type,
        durationMinutes: getDefaultDuration(type),
        valueEur: valueOfType(typeValues, type),
        overdueDays: daysSince(r.next_due, today),
        maxWaitUntil: null,
        entryPrefs: null,
        currentAppointmentId: null,
        currentAppointmentDate: null,
      });
    }
  }

  // ─── 4. Antecipações ─────────────────────────────────────────────────────
  // Quem tem consulta lá para a frente e talvez viesse já. Não traz receita
  // nova — e por isso o valor fica a zero, para não somar duas vezes o mesmo
  // dinheiro — mas troca uma cadeira vazia esta semana por um buraco daqui a um
  // mês, que há muito mais tempo para voltar a preencher.
  if (wants('advance')) {
    const rows = await query(
      `SELECT a.id, a.patient_id, a.type, a.duration, a.appt_date::text AS appt_date
         FROM appointments a
        WHERE a.tenant_id=$1
          AND a.appt_date > ($2::date + ($3::int * INTERVAL '1 day'))
          AND a.status IN ('confirmed','registered')
        ORDER BY a.appt_date`,
      [tenantId, today, ADVANCE_MIN_DAYS_AHEAD],
    );
    for (const r of rows) {
      const type = String(r.type || '');
      raw.push({
        source: 'advance',
        sourceId: String(r.id),
        patientId: String(r.patient_id),
        treatmentType: type,
        durationMinutes: Number(r.duration) || getDefaultDuration(type),
        valueEur: 0,
        overdueDays: 0,
        maxWaitUntil: null,
        entryPrefs: null,
        currentAppointmentId: String(r.id),
        currentAppointmentDate: String(r.appt_date),
      });
    }
  }

  // ─── 5. Reativação ───────────────────────────────────────────────────────
  // A fonte mais fria e a única que exige consentimento de marketing — é a
  // mesma barreira que lib/lifecycle.ts já aplica antes de qualquer SMS de
  // reativação, e não podia ser mais fraca aqui só porque a mensagem traz uma
  // vaga concreta.
  if (wants('reactivation')) {
    const rows = await query(
      `SELECT p.id, p.last_visit::text AS last_visit
         FROM patients p
         JOIN patient_lifecycle_state ls ON ls.patient_id = p.id AND ls.tenant_id = p.tenant_id
        WHERE p.tenant_id=$1 AND ls.stage='inactive' AND p.status <> 'anonymized'
          AND EXISTS (
            SELECT 1 FROM patient_data_consents c
             WHERE c.patient_id = p.id AND c.consent_type = $2 AND c.given = TRUE AND c.revoked_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.patient_id = p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
          )`,
      [tenantId, REACTIVATION_CONSENT_TYPE],
    );
    for (const r of rows) {
      raw.push({
        source: 'reactivation',
        sourceId: String(r.id),
        patientId: String(r.id),
        treatmentType: CHECKUP_APPOINTMENT_TYPE,
        durationMinutes: getDefaultDuration(CHECKUP_APPOINTMENT_TYPE),
        valueEur: valueOfType(typeValues, CHECKUP_APPOINTMENT_TYPE),
        overdueDays: daysSince(r.last_visit, today),
        maxWaitUntil: null,
        entryPrefs: null,
        currentAppointmentId: null,
        currentAppointmentDate: null,
      });
    }
  }

  const counts = {
    waitlist: 0,
    treatment_open: 0,
    recall_due: 0,
    advance: 0,
    reactivation: 0,
  } as Record<DemandSource, number>;
  if (!raw.length) return { candidates: [], counts, warnings, typeValues };

  // ─── Enriquecimento comum ────────────────────────────────────────────────
  const patientIds = [...new Set(raw.map((r) => r.patientId))];
  const [patients, futureAppts, lastContacts, prefsByPatient] = await Promise.all([
    query(
      `SELECT id, name, phone, comm_prefs, no_show_count, visit_count
         FROM patients WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND status <> 'anonymized'`,
      [tenantId, patientIds],
    ),
    query(
      `SELECT patient_id, appt_date::text AS appt_date
         FROM appointments
        WHERE tenant_id=$1 AND patient_id = ANY($2::uuid[]) AND appt_date >= CURRENT_DATE AND status <> 'no-show'`,
      [tenantId, patientIds],
    ),
    query(
      `SELECT patient_id, MAX(created_at) AS last_at
         FROM notifications
        WHERE tenant_id=$1 AND patient_id = ANY($2::uuid[]) AND payload->>'kind' = ANY($3::text[])
        GROUP BY patient_id`,
      [tenantId, patientIds, OUTREACH_KINDS],
    ),
    getPreferencesForPatients(tenantId, patientIds),
  ]);

  const patientById = new Map(patients.map((p) => [String(p.id), p]));
  const busyByPatient = new Map<string, string[]>();
  for (const a of futureAppts) {
    const key = String(a.patient_id);
    busyByPatient.set(key, [...(busyByPatient.get(key) || []), String(a.appt_date)]);
  }
  const lastContactByPatient = new Map(
    lastContacts.map((r) => [String(r.patient_id), r.last_at ? new Date(r.last_at).toISOString() : null]),
  );

  const candidates: DemandCandidate[] = [];
  for (const r of raw) {
    const p = patientById.get(r.patientId);
    // Doente apagado/anonimizado entre a leitura da fonte e esta: não existe
    // procura sem quem a procure.
    if (!p) continue;

    const visits = Number(p.visit_count || 0);
    const noShows = Number(p.no_show_count || 0);
    // Risco ao nível do DOENTE, e não da consulta: aqui ainda não há consulta —
    // é justamente ela que se está a decidir. Os fatores que dependem do
    // horário (dia da semana, hora do dia) ficam de fora por isso, e continuam a
    // ser calculados pelo motor de lib/scheduleIntel.ts depois de marcada.
    const { score } = riskScore({
      patientNoShowRate: visits + noShows > 0 ? noShows / (visits + noShows) : 0,
      isFirstVisit: visits === 0,
    });

    counts[r.source] += 1;
    candidates.push({
      key: `${r.source}:${r.sourceId}`,
      source: r.source,
      sourceId: r.sourceId,
      patientId: r.patientId,
      patientName: String(p.name || '—'),
      phone: (p.phone as string) || null,
      canSms: canAutoContact(p.comm_prefs, 'sms'),
      treatmentType: r.treatmentType,
      durationMinutes: r.durationMinutes,
      valueEur: r.valueEur,
      overdueDays: r.overdueDays,
      noShowRisk: score / 100,
      // A entrada da lista de espera manda sobre o perfil do doente quando as
      // duas existem: quem escreveu "só sábados" naquela inscrição estava a
      // falar daquele tratamento.
      prefs: r.entryPrefs || prefsByPatient.get(r.patientId) || null,
      maxWaitUntil: r.maxWaitUntil,
      busyDates: busyByPatient.get(r.patientId) || [],
      currentAppointmentId: r.currentAppointmentId,
      currentAppointmentDate: r.currentAppointmentDate,
      lastContactedAt: lastContactByPatient.get(r.patientId) || null,
    });
  }

  return { candidates, counts, warnings, typeValues };
}
