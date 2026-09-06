// As seis previsões do bloco 5 — receita, ocupação, procura, cancelamentos, faltas e
// capacidade livre. Este ficheiro só busca séries diárias à base de dados; a matemática
// toda vive em lib/forecastCalc.ts, sem DB e testada isoladamente.
//
// Todas as métricas partilham o mesmo motor: o que muda é a série que entra. Isso é
// deliberado — seis previsões com seis métodos diferentes seriam seis coisas para
// manter e explicar, e a clínica não ganharia nada com isso.
//
// A janela de histórico é de 84 dias (12 semanas): dá pelo menos 12 observações por dia
// da semana, que é o suficiente para a mediana ser estável sem ir buscar um passado tão
// antigo que já não descreve a clínica de hoje.

import { query, queryOne } from './db';
import { type ForecastResult, forecast, isReliable, type Observation } from './forecastCalc';
import { WORK_MINUTES_PER_DAY } from './scheduleIntel';

export const LOOKBACK_DAYS = 84;
export const DEFAULT_HORIZON_DAYS = 14;

export type ForecastMetric = 'revenue' | 'occupancy' | 'demand' | 'cancellations' | 'noShows' | 'freeCapacity';

export interface MetricForecast extends ForecastResult {
  metric: ForecastMetric;
  label: string;
  unit: 'eur' | 'pct' | 'count' | 'hours';
  reliable: boolean;
}

const META: Record<ForecastMetric, { label: string; unit: MetricForecast['unit'] }> = {
  revenue: { label: 'Receita', unit: 'eur' },
  occupancy: { label: 'Ocupação', unit: 'pct' },
  demand: { label: 'Procura', unit: 'count' },
  cancellations: { label: 'Cancelamentos', unit: 'count' },
  noShows: { label: 'Faltas', unit: 'count' },
  freeCapacity: { label: 'Capacidade livre', unit: 'hours' },
};

function rowsToSeries(rows: readonly Record<string, unknown>[]): Observation[] {
  return rows.map((r) => ({
    date: String(r.day).slice(0, 10),
    value: Number(r.value) || 0,
  }));
}

/**
 * Receita diária realizada. Mesma definição de app/api/reports — tratamentos concluídos,
 * pela data em que foram concluídos. Não se usa `invoices`: uma fatura pode ser emitida
 * noutro dia, ou não ser emitida de todo, e o que se está a prever é trabalho feito.
 */
async function revenueSeries(tenantId: string, from: string): Promise<Observation[]> {
  const rows = await query(
    `SELECT updated_at::date AS day, COALESCE(SUM(fee),0)::numeric AS value
     FROM treatments
     WHERE tenant_id=$1 AND status='completed' AND updated_at::date >= $2::date
     GROUP BY day ORDER BY day`,
    [tenantId, from],
  );
  return rowsToSeries(rows);
}

/** Minutos marcados por dia — a base tanto da ocupação como da capacidade livre. */
async function bookedMinutesSeries(tenantId: string, from: string): Promise<Observation[]> {
  const rows = await query(
    `SELECT appt_date AS day, COALESCE(SUM(duration),0)::int AS value
     FROM appointments
     WHERE tenant_id=$1 AND appt_date >= $2::date AND status <> 'no-show'
     GROUP BY day ORDER BY day`,
    [tenantId, from],
  );
  return rowsToSeries(rows);
}

/**
 * Procura = marcações *criadas* por dia, não realizadas. É a pergunta "quantas pessoas
 * pediram consulta hoje", que é o que permite antecipar pressão sobre a agenda — uma
 * consulta marcada hoje para daqui a três semanas é procura de hoje.
 */
async function demandSeries(tenantId: string, from: string): Promise<Observation[]> {
  const rows = await query(
    `SELECT created_at::date AS day, COUNT(*)::int AS value
     FROM appointments
     WHERE tenant_id=$1 AND created_at::date >= $2::date
     GROUP BY day ORDER BY day`,
    [tenantId, from],
  );
  return rowsToSeries(rows);
}

async function cancellationSeries(tenantId: string, from: string): Promise<Observation[]> {
  const rows = await query(
    `SELECT created_at::date AS day, COUNT(*)::int AS value
     FROM appointment_cancellations
     WHERE tenant_id=$1 AND created_at::date >= $2::date
     GROUP BY day ORDER BY day`,
    [tenantId, from],
  );
  return rowsToSeries(rows);
}

async function noShowSeries(tenantId: string, from: string): Promise<Observation[]> {
  const rows = await query(
    `SELECT appt_date AS day, COUNT(*)::int AS value
     FROM appointments
     WHERE tenant_id=$1 AND appt_date >= $2::date AND status='no-show'
     GROUP BY day ORDER BY day`,
    [tenantId, from],
  );
  return rowsToSeries(rows);
}

function isoDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function wrap(metric: ForecastMetric, result: ForecastResult): MetricForecast {
  return { metric, ...META[metric], ...result, reliable: isReliable(result) };
}

/**
 * As seis previsões para os próximos `horizonDays`.
 *
 * A capacidade livre não é prevista a partir do seu próprio histórico — é derivada:
 * capacidade instalada menos os minutos que se prevê ficarem marcados. Prever "espaço
 * vazio" diretamente daria um número que ignora que a capacidade é uma constante da
 * clínica, não um fenómeno a modelar.
 */
export async function computeForecasts(
  tenantId: string,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
  now: Date = new Date(),
): Promise<{ horizonDays: number; generatedAt: string; forecasts: MetricForecast[] }> {
  const from = isoDaysAgo(LOOKBACK_DAYS, now);
  const tenant = await queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]);
  const operatories = Math.max(1, Number(tenant?.operatories || 1));
  const dailyCapacityMinutes = operatories * WORK_MINUTES_PER_DAY;

  const [revenue, booked, demand, cancellations, noShows] = await Promise.all([
    revenueSeries(tenantId, from),
    bookedMinutesSeries(tenantId, from),
    demandSeries(tenantId, from),
    cancellationSeries(tenantId, from),
    noShowSeries(tenantId, from),
  ]);

  const occupancySeries: Observation[] = booked.map((o) => ({
    date: o.date,
    value: Math.min(100, (o.value / dailyCapacityMinutes) * 100),
  }));

  const bookedForecast = forecast(booked, horizonDays, now);
  const freeCapacity: ForecastResult = {
    ...bookedForecast,
    days: bookedForecast.days.map((d) => ({
      ...d,
      // A banda inverte-se: mais marcações previstas significa menos espaço livre.
      value: round2(Math.max(0, (dailyCapacityMinutes - d.value) / 60)),
      low: round2(Math.max(0, (dailyCapacityMinutes - d.high) / 60)),
      high: round2(Math.max(0, (dailyCapacityMinutes - d.low) / 60)),
    })),
    total: 0,
    totalLow: 0,
    totalHigh: 0,
  };
  freeCapacity.total = round2(freeCapacity.days.reduce((a, d) => a + d.value, 0));
  freeCapacity.totalLow = round2(freeCapacity.days.reduce((a, d) => a + d.low, 0));
  freeCapacity.totalHigh = round2(freeCapacity.days.reduce((a, d) => a + d.high, 0));

  return {
    horizonDays,
    generatedAt: now.toISOString(),
    forecasts: [
      wrap('revenue', forecast(revenue, horizonDays, now)),
      wrap('occupancy', forecast(occupancySeries, horizonDays, now)),
      wrap('demand', forecast(demand, horizonDays, now)),
      wrap('cancellations', forecast(cancellations, horizonDays, now)),
      wrap('noShows', forecast(noShows, horizonDays, now)),
      wrap('freeCapacity', freeCapacity),
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
