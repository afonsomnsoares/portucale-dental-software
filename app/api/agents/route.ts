import { AGENTS } from '@/lib/agents/registry';
import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';
import type { AgentJobRun, AgentStatus } from '@/lib/types/agent';

// Estado dos agentes desta clínica: o catálogo (dados estáticos de
// lib/agents/registry.ts) cruzado com a última execução real de cada tarefa que
// lhes pertence, lida de job_runs.
//
// Nada aqui é simulado. Um agente cujas tarefas nunca correram devolve
// lastRun: null, e a página diz isso — em vez de inventar uma execução.
export const GET = withRoute({ permission: 'agents:read' }, async ({ tenantId }) => {
  // Uma linha por job_name: a mais recente desta clínica. O DISTINCT ON é o
  // idioma do Postgres para "o último de cada grupo" e assenta no índice que a
  // migração 038 cria — (tenant_id, job_name, started_at DESC).
  const rows = await queryRead(
    `SELECT DISTINCT ON (job_name) job_name, status, started_at, finished_at, details
       FROM job_runs
      WHERE tenant_id = $1
      ORDER BY job_name, started_at DESC`,
    [tenantId],
  );

  const byJob = new Map<string, AgentJobRun>(
    rows.map((r) => [
      String(r.job_name),
      {
        jobName: String(r.job_name),
        status: String(r.status),
        startedAt: new Date(r.started_at).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        details: (r.details || {}) as Record<string, unknown>,
      },
    ]),
  );

  // Uma execução de 'all' corre as tarefas de todos os agentes de uma vez, por
  // isso conta como execução de qualquer um deles quando for mais recente que a
  // tarefa individual mais recente desse agente.
  const runAll = byJob.get('all') || null;

  const agents: AgentStatus[] = AGENTS.map((agent) => {
    const runs = agent.jobs.map((j) => byJob.get(j)).filter((r): r is AgentJobRun => !!r);
    if (runAll) runs.push(runAll);
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { ...agent, lastRun: runs[0] ?? null };
  });

  return Response.json({ agents });
});
