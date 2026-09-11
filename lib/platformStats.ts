import { queryRead, warnSchemaGap } from './db';
import type { PlatformHealth, UsageRow } from './types/platform';

// ─── As leituras de plataforma, fora das rotas ──────────────────────────────
// Estas consultas viviam dentro de app/api/platform/*. Saíram de lá quando as
// páginas correspondentes passaram a lê-las no servidor: passaram a existir dois
// caminhos até aos mesmos números, e SQL escrito duas vezes diverge à primeira
// coluna nova.
//
// O `warnSchemaGap` e o fallback vazio vêm de lá tal e qual, e a razão é a
// mesma: o painel de plataforma tem de abrir numa base a que ainda falte uma
// migração, em vez de rebentar inteiro por causa de uma tabela.

/**
 * Utilização real por clínica — o que substitui "Usage" e "Retention" enquanto
 * não houver telemetria de produto (sessões, ecrãs vistos, DAU/MAU).
 *
 * O que dá para medir com o que já está gravado: quantos doentes, quantos
 * utilizadores ativos, quantas marcações nos últimos 30 dias e QUANDO foi a
 * última atividade. A última é a que interessa para retenção: uma clínica sem
 * marcações há semanas está a sair, quer o contrato diga o que disser.
 */
export async function tenantUsage(): Promise<UsageRow[]> {
  try {
    return (await queryRead(
      `SELECT t.id, t.name, t.city, t.status, t.created_at, t.operatories,
              (SELECT COUNT(*)::int FROM patients p WHERE p.tenant_id = t.id) AS patients,
              (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.active) AS active_users,
              (SELECT COUNT(*)::int FROM appointments a
                WHERE a.tenant_id = t.id AND a.appt_date > CURRENT_DATE - 30) AS appts_30d,
              (SELECT COUNT(*)::int FROM appointments a
                WHERE a.tenant_id = t.id AND a.appt_date > CURRENT_DATE - 60
                  AND a.appt_date <= CURRENT_DATE - 30) AS appts_prev_30d,
              (SELECT MAX(a.appt_date) FROM appointments a WHERE a.tenant_id = t.id) AS last_appointment,
              (SELECT COUNT(*)::int FROM job_runs r
                WHERE r.tenant_id = t.id AND r.started_at > NOW() - INTERVAL '7 days') AS agent_runs_7d
         FROM tenants t
        ORDER BY t.name`,
    )) as unknown as UsageRow[];
  } catch (e) {
    warnSchemaGap('platform.usage', e);
    return [];
  }
}

/**
 * O estado do sistema medido agora: a base responde, quantas clínicas há por
 * estado, como correram as tarefas nas últimas 24 h e quais pararam.
 *
 * Cada consulta é envolvida individualmente: um painel de saúde que rebenta
 * porque falta uma tabela é um painel que não serve para o que existe.
 */
export async function platformHealth(): Promise<PlatformHealth> {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await queryRead('SELECT 1');
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - t0;

  const safe = async (scope: string, sql: string, params: unknown[] = []) => {
    try {
      return await queryRead(sql, params);
    } catch (e) {
      warnSchemaGap(scope, e);
      return [];
    }
  };

  const [tenantsByStatus, jobs24h, lastRun, staleJobs] = await Promise.all([
    safe('health.tenants', `SELECT status, COUNT(*)::int AS n FROM tenants GROUP BY status ORDER BY status`),
    safe(
      'health.jobs',
      `SELECT status, COUNT(*)::int AS n
         FROM job_runs
        WHERE started_at > NOW() - INTERVAL '24 hours'
        GROUP BY status`,
    ),
    safe('health.lastrun', `SELECT MAX(started_at) AS at FROM job_runs`),
    // Uma tarefa que já correu alguma vez mas não corre há mais de 48h é o sinal
    // mais honesto de "algo parou" que este sistema consegue dar hoje.
    safe(
      'health.stale',
      `SELECT job_name, MAX(started_at) AS last_at
         FROM job_runs
        GROUP BY job_name
       HAVING MAX(started_at) < NOW() - INTERVAL '48 hours'
        ORDER BY 2 ASC
        LIMIT 20`,
    ),
  ]);

  // 'completed' / 'failed' são os dois estados que lib/jobsRunner.ts escreve
  // (logJobRun), não 'ok'/'error'.
  const jobCount = (s: string) => Number(jobs24h.find((r) => r.status === s)?.n || 0);

  return {
    database: { ok: dbOk, latencyMs: dbLatencyMs },
    // O `safe` devolve linhas cruas; a forma de cada consulta está escrita no
    // seu próprio SELECT, e é aqui que se diz qual é.
    tenantsByStatus: tenantsByStatus as Array<{ status: string; n: number }>,
    jobs24h: {
      completed: jobCount('completed'),
      failed: jobCount('failed'),
      total: jobs24h.reduce((a, r) => a + Number(r.n), 0),
    },
    lastJobRunAt: (lastRun[0]?.at as string | undefined) || null,
    staleJobs: staleJobs as Array<{ job_name: string; last_at: string }>,
    // Nomeado à parte para a UI não ter de adivinhar o que falta: são estes os
    // sinais que um "System Health" a sério teria e que este sistema não produz.
    notInstrumented: ['uptime HTTP', 'latência por endpoint', 'saúde de integrações', 'profundidade de filas'],
  };
}
