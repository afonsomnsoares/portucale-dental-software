import { queryOne, queryRead } from './db';
import {
  aggregateVacancyHistory,
  type CellStats,
  explainSlotRisk,
  hourBucketFor,
  projectByDay,
  type SlotProjection,
  slotRisk,
  type VacancyHistoryRow,
} from './slotRiskCalc';

// Liga lib/slotRiskCalc.ts a linhas reais, tal como lib/scheduleIntel.ts faz para
// lib/noShowRisk.ts.
//
// Não recalcula o risco de falta: lê appointments.risk_score, que o job 'risk' já
// persiste. Duas respostas diferentes à mesma pergunta na mesma aplicação seria pior do
// que não ter resposta nenhuma — e o número que interessa aqui não é o risco de o
// doente não aparecer, é o risco de o LUGAR ficar vazio, que é outra coisa.

const HISTORY_MONTHS = 12;
const DEFAULT_HORIZON_DAYS = 21;

// Histórico de como esta clínica costuma perder lugares. Duas fontes, como em
// lib/scheduleIntel.ts: consultas passadas (comparecidas ou faltadas) e a tabela de
// cancelamentos, que é a única que sabe COM QUE ANTECEDÊNCIA se avisou — e é essa
// antecedência que separa tempo perdido de tempo recuperável.
async function vacancyHistory(tenantId: string): Promise<VacancyHistoryRow[]> {
  const [outcomes, cancellations] = await Promise.all([
    queryRead(
      `SELECT appt_date, start_time::text AS start_time,
              CASE WHEN status='no-show' THEN 'no-show' ELSE 'attended' END AS outcome
       FROM appointments
       WHERE tenant_id=$1 AND appt_date < CURRENT_DATE
         AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')
         AND status IN ('no-show','departed')`,
      [tenantId, HISTORY_MONTHS],
    ),
    queryRead(
      `SELECT appt_date, start_time::text AS start_time, 'cancelled' AS outcome,
              -- Dias entre o aviso e a consulta. GREATEST(...,0) porque um cancelamento
              -- registado depois da hora da consulta (acontece: alguém arruma a agenda
              -- no fim do dia) não é um aviso com antecedência negativa — é nenhum.
              GREATEST(0, (appt_date - created_at::date))::int AS notice_days
       FROM appointment_cancellations
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')`,
      [tenantId, HISTORY_MONTHS],
    ),
  ]);
  return [
    ...outcomes.map((r) => ({ apptDate: r.appt_date, startTime: String(r.start_time), outcome: r.outcome })),
    ...cancellations.map((r) => ({
      apptDate: r.appt_date,
      startTime: String(r.start_time),
      outcome: 'cancelled' as const,
      noticeDays: Number(r.notice_days),
    })),
  ] as VacancyHistoryRow[];
}

// As médias da clínica inteira, para as células com poucas observações caírem nelas em
// vez de produzirem 0% ou 100% a partir de três consultas.
function clinicShares(cells: CellStats[]) {
  const totals = cells.reduce(
    (acc, c) => ({
      noShows: acc.noShows + c.noShows,
      cancels: acc.cancels + c.cancellations,
      timely: acc.timely + c.cancellations * c.timelyCancelShare,
    }),
    { noShows: 0, cancels: 0, timely: 0 },
  );
  const lost = totals.noShows + totals.cancels;
  return {
    clinicNoShowShare: lost > 0 ? totals.noShows / lost : 0.5,
    clinicTimelyCancelShare: totals.cancels > 0 ? totals.timely / totals.cancels : 0.6,
  };
}

// Quantas pessoas da lista de espera serviriam para um lugar num dado dia da semana e
// balde horário. Não é a profundidade total da lista: uma lista com trinta pessoas que
// só podem às terças de manhã não ajuda nada a uma vaga de sexta à tarde.
async function waitlistDepthByCell(tenantId: string): Promise<Map<string, number>> {
  const rows = await queryRead(
    `SELECT preferred_days, preferred_time_start::text AS ts, preferred_time_end::text AS te, min_duration
     FROM waitlist_entries WHERE tenant_id=$1 AND status='active'`,
    [tenantId],
  );
  const depth = new Map<string, number>();
  const buckets = ['morning', 'afternoon', 'evening'];
  for (const r of rows) {
    const days: number[] =
      Array.isArray(r.preferred_days) && r.preferred_days.length
        ? (r.preferred_days as number[]).map(Number)
        : [0, 1, 2, 3, 4, 5, 6];
    const startHour = r.ts ? Number(String(r.ts).slice(0, 2)) : null;
    const endHour = r.te ? Number(String(r.te).slice(0, 2)) : null;
    for (const weekday of days) {
      for (const bucket of buckets) {
        // Sem janela horária declarada, o candidato serve para qualquer balde.
        if (startHour !== null || endHour !== null) {
          const b = bucket === 'morning' ? 10 : bucket === 'afternoon' ? 14 : 18;
          if (startHour !== null && b < startHour) continue;
          if (endHour !== null && b >= endHour) continue;
        }
        const key = `${weekday}:${bucket}`;
        depth.set(key, (depth.get(key) || 0) + 1);
      }
    }
  }
  return depth;
}

// Com que frequência é que, historicamente, uma vaga daquele dia/balde foi de facto
// reocupada. Aproximado pela proporção de consultas criadas com pouca antecedência —
// uma marcação feita a menos de três dias da data é, quase sempre, o preenchimento de
// um buraco.
async function historicalFillRates(tenantId: string): Promise<Map<string, number>> {
  const rows = await queryRead(
    `SELECT appt_date, start_time::text AS start_time,
            (appt_date - created_at::date) <= 3 AS short_notice
     FROM appointments
     WHERE tenant_id=$1 AND appt_date < CURRENT_DATE
       AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')`,
    [tenantId, HISTORY_MONTHS],
  );
  const cells = new Map<string, { total: number; short: number }>();
  for (const r of rows) {
    const weekday = new Date(r.appt_date).getUTCDay();
    const bucket = hourBucketFor(Number(String(r.start_time).slice(0, 2)));
    const key = `${weekday}:${bucket}`;
    const c = cells.get(key) || { total: 0, short: 0 };
    c.total += 1;
    if (r.short_notice) c.short += 1;
    cells.set(key, c);
  }
  // Escala: uma clínica em que 20% das marcações são de última hora é uma clínica com
  // procura de curto prazo real, e isso já é uma capacidade de reposição alta. Sem a
  // escala, nenhuma clínica passaria de 0.3 e a probabilidade de reposição seria
  // sistematicamente subestimada.
  return new Map(
    Array.from(cells.entries()).map(([k, c]) => [k, c.total > 0 ? Math.min(1, (c.short / c.total) * 3) : 0.5]),
  );
}

// ─── Quanto vale um lugar ───────────────────────────────────────────────────
// Por TIPO de consulta, e não uma média única da clínica: uma Reabilitação Oral e uma
// Destartarização não valem o mesmo, e tratá-las por igual é precisamente o erro que
// leva a receção a telefonar às pessoas erradas — a média enterra a consulta cara no
// meio das baratas e faz as baratas parecerem valer o triplo.
//
// A ligação fatura↔consulta existe desde a migração 042 (invoices.appointment_id, única
// por consulta). Tipos com poucas observações caem na média da clínica em vez de
// produzirem um valor a partir de duas faturas — mesmo raciocínio do clinicShares acima.
const MIN_INVOICES_PER_TYPE = 3;

async function valuePerAppointmentType(tenantId: string) {
  const [porTipo, global] = await Promise.all([
    queryRead(
      `SELECT a.type, AVG(i.amount)::numeric AS fee, COUNT(*)::int AS n
       FROM invoices i
       JOIN appointments a ON a.id = i.appointment_id
       WHERE i.tenant_id=$1 AND i.status <> 'cancelled'
         AND i.invoice_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')
       GROUP BY a.type`,
      [tenantId, HISTORY_MONTHS],
    ),
    queryOne(
      `SELECT AVG(amount)::numeric AS fee FROM invoices
       WHERE tenant_id=$1 AND status <> 'cancelled'
         AND invoice_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')`,
      [tenantId, HISTORY_MONTHS],
    ),
  ]);

  const fallback = global?.fee == null ? null : Number(global.fee);
  const byType = new Map<string, number>();
  for (const r of porTipo) {
    if (Number(r.n) >= MIN_INVOICES_PER_TYPE && r.fee != null) byType.set(String(r.type), Number(r.fee));
  }
  // Uma clínica sem faturação nenhuma devolve null em tudo — e null chega ao ecrã como
  // «—», que é a resposta honesta. Ver o comentário de SlotProjection.valueEur.
  return (type: string): number | null => byType.get(type) ?? fallback;
}

export interface SlotRiskReport {
  horizonDays: number;
  generatedAt: string;
  days: ReturnType<typeof projectByDay>;
  totals: { bookedMinutes: number; expectedEmptyMinutes: number; atRisk: number };
  // A perda esperada em euros, quando há faturação de que a derivar. Passou a ser a soma
  // das perdas por slot (valor do tipo × P(fica vazio)) em vez de uma regra de três
  // sobre a média da clínica — ver o cabeçalho de valuePerAppointmentType.
  expectedRevenueLoss: number | null;
  explanations: Record<string, string>;
}

export async function computeSlotRisk(tenantId: string, days = DEFAULT_HORIZON_DAYS): Promise<SlotRiskReport> {
  const [history, waitlist, fillRates, upcoming, valorDoTipo] = await Promise.all([
    vacancyHistory(tenantId),
    waitlistDepthByCell(tenantId),
    historicalFillRates(tenantId),
    queryRead(
      `SELECT a.id, a.appt_date::text AS appt_date, a.start_time::text AS start_time, a.chair, a.duration,
              a.type,
              COALESCE(a.risk_score, 0)::int AS risk_score,
              COALESCE(p.name, a.patient_name, '—') AS patient_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.tenant_id=$1 AND a.appt_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int * INTERVAL '1 day')
         AND a.status NOT IN ('no-show','departed')
       ORDER BY a.appt_date, a.start_time`,
      [tenantId, days],
    ),
    valuePerAppointmentType(tenantId),
  ]);

  const cells = aggregateVacancyHistory(history);
  const shares = clinicShares(cells);
  const today = new Date();
  const explanations: Record<string, string> = {};

  const slots: SlotProjection[] = upcoming.map((a) => {
    const date = String(a.appt_date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const bucket = hourBucketFor(Number(String(a.start_time).slice(0, 2)));
    const key = `${weekday}:${bucket}`;
    const daysUntil = Math.max(
      0,
      Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000,
      ),
    );

    const risk = slotRisk(
      {
        riskScore: Number(a.risk_score) || 0,
        weekday,
        bucket,
        daysUntil,
        matchingWaitlistDepth: waitlist.get(key) || 0,
        historicalFillRate: fillRates.get(key),
        ...shares,
      },
      cells,
    );
    explanations[String(a.id)] = explainSlotRisk(risk);
    return {
      appointmentId: String(a.id),
      patientName: String(a.patient_name),
      date,
      startTime: String(a.start_time).slice(0, 5),
      chair: Number(a.chair),
      durationMinutes: Number(a.duration) || 30,
      risk,
      valueEur: valorDoTipo(String(a.type)),
    };
  });

  const byDay = projectByDay(slots);
  const bookedMinutes = byDay.reduce((s, d) => s + d.bookedMinutes, 0);
  const expectedEmptyMinutes = byDay.reduce((s, d) => s + d.expectedEmptyMinutes, 0);
  const diasComValor = byDay.filter((d) => d.expectedEmptyValueEur != null);

  return {
    horizonDays: days,
    generatedAt: new Date().toISOString(),
    days: byDay,
    totals: {
      bookedMinutes,
      expectedEmptyMinutes,
      atRisk: byDay.reduce((s, d) => s + d.atRisk.length, 0),
    },
    // Agora é a soma do que cada lugar vale vezes a probabilidade de cada lugar ficar
    // vazio, e não uma regra de três sobre a média da clínica. A diferença não é de
    // precisão decimal: a fórmula anterior espalhava o risco uniformemente pelas
    // consultas todas, por isso uma agenda com uma Reabilitação Oral em risco e vinte
    // higienes seguras dava o mesmo total que o contrário — que é exatamente a distinção
    // pela qual alguém consulta este número. null quando não há faturação nenhuma de que
    // o derivar: inventar um valor de mercado daria uma perda com aparência de rigor e
    // nenhum.
    expectedRevenueLoss: diasComValor.length
      ? Math.round(diasComValor.reduce((s, d) => s + (d.expectedEmptyValueEur ?? 0), 0))
      : null,
    explanations,
  };
}
