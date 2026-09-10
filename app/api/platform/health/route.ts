import type { NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth';
import { queryRead, warnSchemaGap } from '@/lib/db';
import { requirePlatform } from '@/lib/platform';

// Estado do sistema, medido — não declarado.
//
// Tudo o que esta rota devolve sai de uma consulta real: a latência é o tempo do
// próprio ida-e-volta ao Postgres, a frescura dos jobs sai de job_runs, as clínicas
// por estado saem de tenants. O que NÃO existe (uptime de HTTP, saúde de
// integrações, filas) não é estimado aqui — a página diz que não está instrumentado.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  const blocked = await requirePlatform(user);
  if (blocked) return blocked;

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

  return Response.json({
    database: { ok: dbOk, latencyMs: dbLatencyMs },
    tenantsByStatus,
    jobs24h: {
      completed: jobCount('completed'),
      failed: jobCount('failed'),
      total: jobs24h.reduce((a, r) => a + Number(r.n), 0),
    },
    lastJobRunAt: lastRun[0]?.at || null,
    staleJobs,
    // Nomeado à parte para a UI não ter de adivinhar o que falta: são estes os
    // sinais que um "System Health" a sério teria e que este sistema não produz.
    notInstrumented: ['uptime HTTP', 'latência por endpoint', 'saúde de integrações', 'profundidade de filas'],
  });
}
