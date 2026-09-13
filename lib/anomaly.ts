// "Isto não é normal" — deteção sobre os dados da clínica, com a causa provável.
//
// A matemática vive em lib/anomalyCalc.ts (pura, testada). Aqui só se buscam as séries
// semanais e se traduz o resultado em conclusões para agent_insights.
//
// ─── Porque é determinístico e não IA ──────────────────────────────────────────
// Detetar que um número saiu do normal é aritmética, e aritmética não deve custar uma
// chamada a um modelo nem ficar sujeita a variação entre corridas. A IA (managementAgent)
// continua a fazer o que faz bem: ler o conjunto e escrever uma narrativa. Estas
// conclusões são a base factual que ela não tem de inventar — e por isso convivem sob o
// mesmo agente 'management', separadas por tipo (ver replaceOpenInsights).
//
// ─── Semanas, não dias ─────────────────────────────────────────────────────────
// Um dia mau é ruído numa clínica: um feriado, uma avaria, um dentista doente. A semana
// é a menor unidade em que a sazonalidade semanal desaparece e um desvio significa
// mesmo alguma coisa. Compara-se a última semana completa com as anteriores.

import type { ClampedInsight } from './agents/insightCalc';
import { aiActor, replaceOpenInsights } from './agents/insights';
import { attributeCause, describeCause, detectAnomaly, type Segment } from './anomalyCalc';
import { query, queryOne } from './db';
import { WORK_MINUTES_PER_DAY } from './scheduleIntel';

const AGENT_ID = 'management';
export const ANOMALY_KINDS = [
  'occupancy_anomaly',
  'revenue_anomaly',
  'no_show_anomaly',
  'cancellation_anomaly',
] as const;

/** Semanas de histórico. 10 dá 9 observações para definir o normal — acima de MIN_HISTORY. */
const WEEKS = 10;

interface WeekSegmentRow {
  week: string;
  segment: string | null;
  value: number;
}

/**
 * Uma série semanal decomposta por segmento. Devolve os totais por semana (para detetar)
 * e a decomposição da última semana contra a média das anteriores (para explicar).
 */
function split(rows: readonly WeekSegmentRow[]) {
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  if (weeks.length < 2) return null;

  const currentWeek = weeks[weeks.length - 1];
  const priorWeeks = weeks.slice(0, -1);

  const totalFor = (w: string) => rows.filter((r) => r.week === w).reduce((a, r) => a + r.value, 0);

  const current = totalFor(currentWeek);
  const history = priorWeeks.map(totalFor);

  const after: Segment[] = [];
  const beforeAcc = new Map<string, number>();
  for (const r of rows) {
    const label = r.segment || 'Sem atribuição';
    if (r.week === currentWeek) {
      const existing = after.find((s) => s.label === label);
      if (existing) existing.value += r.value;
      else after.push({ label, value: r.value });
    } else {
      beforeAcc.set(label, (beforeAcc.get(label) || 0) + r.value);
    }
  }
  // Média por semana, para comparar uma semana com uma semana — não com nove somadas.
  const before: Segment[] = [...beforeAcc].map(([label, total]) => ({
    label,
    value: total / priorWeeks.length,
  }));

  return { current, history, before, after, currentWeek };
}

async function weekSegmentRows(sql: string, params: unknown[]): Promise<WeekSegmentRow[]> {
  const rows = await query(sql, params);
  return rows.map((r) => ({
    week: String(r.week).slice(0, 10),
    segment: r.segment === null || r.segment === undefined ? null : String(r.segment),
    value: Number(r.value) || 0,
  }));
}

function fmt(n: number, unit: string): string {
  return `${Math.round(n * 10) / 10}${unit}`;
}

/**
 * Todas as anomalias da clínica na última semana completa.
 *
 * Devolve conclusões prontas para agent_insights. `impactEur` só é preenchido onde o
 * valor é *derivado* dos dados (a diferença de receita) — nunca estimado. Uma queda de
 * ocupação tem certamente um custo, mas convertê-lo em euros exigiria supor uma receita
 * por minuto que a clínica não declarou, e um número suposto ao lado de números reais
 * contamina os dois.
 */
async function computeAnomalies(tenantId: string): Promise<ClampedInsight[]> {
  const since = `${WEEKS} weeks`;
  const tenant = await queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]);
  const operatories = Math.max(1, Number(tenant?.operatories || 1));
  const weeklyCapacityMinutes = operatories * WORK_MINUTES_PER_DAY * 5;

  const [occupancy, revenue, noShows, cancellations] = await Promise.all([
    // Ocupação: minutos marcados por semana, atribuídos ao dentista.
    weekSegmentRows(
      `SELECT date_trunc('week', a.appt_date)::date AS week,
              COALESCE(u.name, 'Sem dentista') AS segment,
              COALESCE(SUM(a.duration),0)::int AS value
       FROM appointments a
       LEFT JOIN users u ON u.id = a.dentist_id
       WHERE a.tenant_id=$1 AND a.status <> 'no-show'
         AND a.appt_date >= (CURRENT_DATE - $2::interval)
         AND a.appt_date < date_trunc('week', CURRENT_DATE)
       GROUP BY week, segment ORDER BY week`,
      [tenantId, since],
    ),
    // Receita: tratamentos concluídos, atribuídos à categoria do tratamento.
    weekSegmentRows(
      `SELECT date_trunc('week', t.updated_at)::date AS week,
              COALESCE(NULLIF(tc.category, ''), 'Sem categoria') AS segment,
              COALESCE(SUM(t.fee),0)::numeric AS value
       FROM treatments t
       LEFT JOIN treatment_codes tc
         ON tc.code = t.treatment_code AND (tc.tenant_id = t.tenant_id OR tc.tenant_id IS NULL)
       WHERE t.tenant_id=$1 AND t.status='completed'
         AND t.updated_at >= (CURRENT_DATE - $2::interval)
         AND t.updated_at < date_trunc('week', CURRENT_DATE)
       GROUP BY week, segment ORDER BY week`,
      [tenantId, since],
    ),
    weekSegmentRows(
      `SELECT date_trunc('week', a.appt_date)::date AS week,
              COALESCE(u.name, 'Sem dentista') AS segment,
              COUNT(*)::int AS value
       FROM appointments a
       LEFT JOIN users u ON u.id = a.dentist_id
       WHERE a.tenant_id=$1 AND a.status='no-show'
         AND a.appt_date >= (CURRENT_DATE - $2::interval)
         AND a.appt_date < date_trunc('week', CURRENT_DATE)
       GROUP BY week, segment ORDER BY week`,
      [tenantId, since],
    ),
    weekSegmentRows(
      `SELECT date_trunc('week', c.created_at)::date AS week,
              COALESCE(u.name, 'Sem dentista') AS segment,
              COUNT(*)::int AS value
       FROM appointment_cancellations c
       LEFT JOIN users u ON u.id = c.dentist_id
       WHERE c.tenant_id=$1
         AND c.created_at >= (CURRENT_DATE - $2::interval)
         AND c.created_at < date_trunc('week', CURRENT_DATE)
       GROUP BY week, segment ORDER BY week`,
      [tenantId, since],
    ),
  ]);

  const out: ClampedInsight[] = [];

  // ─── Ocupação ───────────────────────────────────────────────────────────────
  const occ = split(occupancy);
  if (occ) {
    const toPct = (minutes: number) => (minutes / weeklyCapacityMinutes) * 100;
    const a = detectAnomaly(toPct(occ.current), occ.history.map(toPct));
    if (a) {
      const causes = attributeCause(occ.before, occ.after);
      const verbo = a.direction === 'down' ? 'caiu' : 'subiu';
      out.push({
        kind: 'occupancy_anomaly',
        severity: a.severity,
        title: `Ocupação ${verbo} ${fmt(a.deviationPct, '%')} face ao habitual`,
        body:
          `A semana fechou com ${fmt(a.current, '%')} de ocupação, contra ${fmt(a.baseline, '%')} ` +
          `nas semanas anteriores.${causes.length ? ` A variação vem ${describeCause(causes)}.` : ''}`,
        impactEur: null,
      });
    }
  }

  // ─── Receita ────────────────────────────────────────────────────────────────
  const rev = split(revenue);
  if (rev) {
    const a = detectAnomaly(rev.current, rev.history);
    if (a) {
      const causes = attributeCause(rev.before, rev.after);
      const gap = Math.abs(rev.current - a.baseline);
      const verbo = a.direction === 'down' ? 'abaixo' : 'acima';
      out.push({
        kind: 'revenue_anomaly',
        severity: a.direction === 'down' ? a.severity : 'info',
        title: `Receita ${fmt(a.deviationPct, '%')} ${verbo} do habitual`,
        body:
          `A semana rendeu ${fmt(a.current, ' €')}, contra ${fmt(a.baseline, ' €')} por semana ` +
          `no período anterior.${causes.length ? ` A diferença vem ${describeCause(causes)}.` : ''}`,
        // Derivado, não estimado: é a diferença entre o que rendeu e o que costuma render.
        impactEur: a.direction === 'down' ? Math.round(gap * 100) / 100 : null,
      });
    }
  }

  // ─── Faltas ─────────────────────────────────────────────────────────────────
  const ns = split(noShows);
  if (ns) {
    const a = detectAnomaly(ns.current, ns.history);
    // Só interessa quando sobem: menos faltas não é um problema a reportar.
    if (a && a.direction === 'up') {
      const causes = attributeCause(ns.before, ns.after);
      out.push({
        kind: 'no_show_anomaly',
        severity: a.severity,
        title: `Faltas subiram ${fmt(a.deviationPct, '%')}`,
        body:
          `${Math.round(a.current)} faltas na semana, contra ${fmt(a.baseline, '')} habituais.` +
          `${causes.length ? ` Concentram-se ${describeCause(causes)}.` : ''}`,
        impactEur: null,
      });
    }
  }

  // ─── Cancelamentos ──────────────────────────────────────────────────────────
  const can = split(cancellations);
  if (can) {
    const a = detectAnomaly(can.current, can.history);
    if (a && a.direction === 'up') {
      const causes = attributeCause(can.before, can.after);
      out.push({
        kind: 'cancellation_anomaly',
        severity: a.severity,
        title: `Cancelamentos subiram ${fmt(a.deviationPct, '%')}`,
        body:
          `${Math.round(a.current)} cancelamentos na semana, contra ${fmt(a.baseline, '')} habituais.` +
          `${causes.length ? ` Sobretudo ${describeCause(causes).replace(/^sobretudo /, '')}.` : ''}`,
        impactEur: null,
      });
    }
  }

  return out;
}

/** Deteta e persiste. Chamado pela tarefa `anomalyReview` de lib/jobsRunner.ts. */
export async function runAnomalyReview(tenantId: string) {
  const insights = await computeAnomalies(tenantId);
  const written = await replaceOpenInsights(tenantId, AGENT_ID, insights, aiActor('Gestão'), {
    kinds: [...ANOMALY_KINDS],
  });
  return { ...written, anomalies: insights.length };
}
