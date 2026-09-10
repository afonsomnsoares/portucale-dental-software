import { AGENTS, agentForJob } from '@/lib/agents/registry';
import { queryRead, warnSchemaGap } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Execuções de agentes em TODA a rede — a versão de plataforma do que
// /api/agents dá por clínica.
//
// A fonte é job_runs, que é o registo real de execuções que o projeto já
// escreve (lib/jobsRunner.ts). O mapa job→agente vem do registo estático
// (lib/agents/registry.ts), por isso filtrar por agente é filtrar pelas suas
// tarefas — sem coluna nova e sem migração.
export const GET = withRoute({ platform: 'agents:read', tenant: 'optional' }, async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const agent = searchParams.get('agent');
  const tenant = searchParams.get('tenant');
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 100)));

  const vals: unknown[] = [];
  let where = 'WHERE 1=1';
  if (status) {
    vals.push(status);
    where += ` AND r.status = $${vals.length}`;
  }
  if (tenant) {
    vals.push(tenant);
    where += ` AND r.tenant_id = $${vals.length}::uuid`;
  }
  if (agent) {
    const jobs = AGENTS.find((a) => a.id === agent)?.jobs;
    // Um agente sem tarefas conhecidas não deve devolver a rede inteira — devolve nada.
    vals.push(jobs?.length ? [...jobs] : ['__none__']);
    where += ` AND r.job_name = ANY($${vals.length}::text[])`;
  }
  vals.push(limit);

  // Tipada à mão porque queryRead devolve linhas cruas (`any`): sem isto o spread
  // abaixo apagava as colunas e `r.status` deixava de existir para o TypeScript.
  interface RunRow {
    id: string;
    job_name: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    tenant_id: string | null;
    tenant_name: string | null;
    tenant_city: string | null;
    has_error: boolean;
    error: string | null;
    details_bytes: number;
  }
  let rows: RunRow[] = [];
  try {
    rows = (await queryRead(
      `SELECT r.id, r.job_name, r.status, r.started_at, r.finished_at, r.tenant_id,
              t.name AS tenant_name, t.city AS tenant_city,
              -- O payload inteiro pode ter milhares de linhas por passagem; a lista só
              -- precisa de saber se existe e o erro quando falhou. O detalhe vai em
              -- /api/platform/agent-runs/[id].
              (r.details ? 'error')::bool AS has_error,
              r.details->>'error' AS error,
              pg_column_size(r.details) AS details_bytes
         FROM job_runs r
         LEFT JOIN tenants t ON t.id = r.tenant_id
         ${where}
        ORDER BY r.started_at DESC NULLS LAST
        LIMIT $${vals.length}`,
      vals,
    )) as RunRow[];
  } catch (e) {
    warnSchemaGap('platform.agent-runs', e);
  }

  const runs = rows.map((r) => ({
    ...r,
    agentId: agentForJob(r.job_name),
    durationMs:
      r.finished_at && r.started_at ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() : null,
  }));

  return Response.json({
    runs,
    // Resumo por agente das últimas 24h, para os cartões do topo da página.
    summary: AGENTS.map((a) => {
      const mine = runs.filter((r) => r.agentId === a.id);
      return {
        id: a.id,
        name: a.name,
        icon: a.icon,
        ai: a.ai,
        total: mine.length,
        failed: mine.filter((r) => r.status === 'failed').length,
        lastAt: mine[0]?.started_at || null,
      };
    }),
  });
});
