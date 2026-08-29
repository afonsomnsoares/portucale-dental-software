import { businessDays } from './recoveryCalc';
import { query, queryOne } from './db';
import {
  aggregateByWeekdayHour,
  hourBucketFor,
  ratesByHourBucket,
  ratesByWeekday,
  riskScore,
  type HistoricalRow,
} from './noShowRisk';

const RISK_HISTORY_MONTHS = 6;
const UPCOMING_RISK_DAYS = 14;
const HIGH_RISK_THRESHOLD = 60;

async function historicalRows(tenantId: string): Promise<HistoricalRow[]> {
  const [attendedOrNoShow, cancellations] = await Promise.all([
    query(
      `SELECT appt_date, start_time,
              CASE WHEN status='no-show' THEN 'no-show' ELSE 'attended' END AS outcome
       FROM appointments
       WHERE tenant_id=$1 AND appt_date < CURRENT_DATE
         AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')
         AND status IN ('no-show','departed')`,
      [tenantId, RISK_HISTORY_MONTHS],
    ),
    query(
      `SELECT appt_date, start_time, 'cancelled' AS outcome
       FROM appointment_cancellations
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE - ($2::int * INTERVAL '1 month')`,
      [tenantId, RISK_HISTORY_MONTHS],
    ),
  ]);
  return [...attendedOrNoShow, ...cancellations] as HistoricalRow[];
}

// Scores every appointment in the next `days` and persists the score onto
// appointments.risk_score (+ risk_score_computed_at, so read paths can tell a computed
// score apart from the column's insert default).
export async function computeUpcomingRisk(tenantId: string, days = UPCOMING_RISK_DAYS) {
  const rows = await historicalRows(tenantId);
  const weekdayRates = ratesByWeekday(rows);
  const hourRates = ratesByHourBucket(rows);

  const upcoming = await query(
    `SELECT a.id, a.patient_id, a.appt_date, a.start_time, a.type,
            p.name AS patient_name, p.phone,
            COALESCE(p.no_show_count,0)::int AS no_show_count,
            COALESCE(p.visit_count,0)::int AS visit_count,
            (SELECT COUNT(*)::int FROM appointment_cancellations c WHERE c.patient_id=a.patient_id) AS cancel_count
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.tenant_id=$1 AND a.appt_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int * INTERVAL '1 day')
       AND a.status NOT IN ('no-show','departed')
     ORDER BY a.appt_date, a.start_time`,
    [tenantId, days],
  );

  const todayUTC = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const scored = upcoming.map((a) => {
    const apptDate = new Date(`${String(a.appt_date).slice(0, 10)}T00:00:00Z`);
    const weekday = apptDate.getUTCDay();
    const hour = Number(String(a.start_time).slice(0, 2));
    const bucket = hourBucketFor(hour);
    const leadTimeDays = Math.max(0, Math.round((apptDate.getTime() - todayUTC.getTime()) / 86400000));
    const visits = Number(a.visit_count) + Number(a.cancel_count);

    const { score, factors } = riskScore({
      patientNoShowRate: Number(a.visit_count) > 0 ? Number(a.no_show_count) / Number(a.visit_count) : 0,
      patientCancelRate: visits > 0 ? Number(a.cancel_count) / visits : 0,
      weekdayBaseRate: weekdayRates.get(weekday) || 0,
      hourBaseRate: hourRates.get(bucket) || 0,
      leadTimeDays,
      isFirstVisit: Number(a.visit_count) === 0,
    });

    return {
      id: a.id,
      patient_id: a.patient_id,
      patient_name: a.patient_name,
      phone: a.phone,
      appt_date: a.appt_date,
      start_time: a.start_time,
      type: a.type,
      score,
      factors,
    };
  });

  for (const s of scored) {
    await query(`UPDATE appointments SET risk_score=$1, risk_score_computed_at=NOW() WHERE id=$2`, [s.score, s.id]);
  }

  scored.sort((a, b) => b.score - a.score);
  return { scored, highRisk: scored.filter((s) => s.score >= HIGH_RISK_THRESHOLD) };
}

export async function computeRiskHeatmap(tenantId: string) {
  const rows = await historicalRows(tenantId);
  return { cells: aggregateByWeekdayHour(rows), sampleSize: rows.length, historyMonths: RISK_HISTORY_MONTHS };
}

// Agenda inefficiency signals beyond the static "empty slots" KPI already in Revenue
// Recovery: chair/dentist utilization, schedule fragmentation (gaps between appointments
// on the same chair-day), and last-minute cancellation rate.
export async function computeAgendaEfficiency(tenantId: string, days = UPCOMING_RISK_DAYS) {
  const tenant = await queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]);
  const operatories = Math.max(1, Number(tenant?.operatories || 1));

  const [bookedRow, byChairDay, lastMinuteRow] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(duration),0)::int AS minutes
       FROM appointments
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
         AND status NOT IN ('no-show','cancelled')`,
      [tenantId, days],
    ),
    query(
      `SELECT appt_date, chair, array_agg(start_time ORDER BY start_time) AS starts,
              array_agg(duration ORDER BY start_time) AS durations
       FROM appointments
       WHERE tenant_id=$1 AND appt_date >= CURRENT_DATE AND appt_date < CURRENT_DATE + ($2::int * INTERVAL '1 day')
         AND status NOT IN ('no-show','cancelled')
       GROUP BY appt_date, chair
       HAVING COUNT(*) > 1`,
      [tenantId, days],
    ),
    queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE c.appt_date <= (c.created_at AT TIME ZONE 'UTC')::date + 2)::int AS last_minute
       FROM appointment_cancellations c
       WHERE c.tenant_id=$1 AND c.created_at >= NOW() - ($2::int * INTERVAL '1 day')`,
      [tenantId, RISK_HISTORY_MONTHS * 30],
    ),
  ]);

  const days2 = businessDays(days);
  const capacityMinutes = operatories * 480 * days2;
  const bookedMinutes = Number(bookedRow?.minutes || 0);
  const utilizationPct = capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 100) : 0;

  let gapMinutes = 0;
  let gapCount = 0;
  for (const row of byChairDay) {
    const starts = (row.starts as string[]).map((t) => {
      const [h, m] = t.slice(0, 5).split(':').map(Number);
      return h * 60 + m;
    });
    const durations = (row.durations as number[]).map(Number);
    for (let i = 1; i < starts.length; i++) {
      const prevEnd = starts[i - 1] + durations[i - 1];
      const gap = starts[i] - prevEnd;
      if (gap > 0) {
        gapMinutes += gap;
        gapCount += 1;
      }
    }
  }

  return {
    operatories,
    windowDays: days,
    utilizationPct,
    bookedMinutes,
    capacityMinutes,
    fragmentation: { gapCount, gapMinutes },
    lastMinuteCancellations: {
      total: Number(lastMinuteRow?.total || 0),
      withinTwoDays: Number(lastMinuteRow?.last_minute || 0),
    },
  };
}
