import { agentForJob } from '@/lib/agents/registry';
import { queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

// O detalhe de UMA execução — o ecrã de observabilidade.
//
// O traço pedido (input → contexto → decisão → ferramentas → ações → resultado →
// avaliação) só existe em parte. O que job_runs guarda hoje é o FIM: o payload que
// a passagem produziu (details) e o estado. As etapas intermédias não são gravadas
// por ninguém, e esta rota não as inventa: devolve os estágios que consegue provar e
// declara os que faltam em `missingStages`, para a UI os mostrar como lacuna em vez
// de os omitir em silêncio.
export const GET = withRoute<{ id: string }>({ platform: 'agents:read', tenant: 'optional' }, async ({ params }) => {
  const { id } = params;
  if (!/^\d+$/.test(id)) return Response.json({ error: 'Id inválido' }, { status: 400 });

  const run = await queryOne(
    `SELECT r.*, t.name AS tenant_name, t.city AS tenant_city
       FROM job_runs r LEFT JOIN tenants t ON t.id = r.tenant_id
      WHERE r.id = $1::bigint`,
    [id],
  );
  if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 });

  const details = (run.details || {}) as Record<string, unknown>;
  const agentId = agentForJob(String(run.job_name));

  // Os insights que esta clínica produziu na janela da execução. É o mais perto de
  // "ações e resultado" que há prova para dar: o agente escreve-os quando conclui algo.
  const insights = run.tenant_id
    ? await queryOne(
        `SELECT COUNT(*)::int AS n
           FROM agent_insights
          WHERE tenant_id = $1::uuid AND agent_id = $2
            AND created_at BETWEEN $3 AND COALESCE($4, NOW())`,
        [run.tenant_id, agentId, run.started_at, run.finished_at],
      )
    : null;

  return Response.json({
    run: {
      id: run.id,
      jobName: run.job_name,
      agentId,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      tenantId: run.tenant_id,
      tenantName: run.tenant_name,
      tenantCity: run.tenant_city,
      durationMs:
        run.finished_at && run.started_at
          ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
          : null,
    },
    // Cada estágio traz `recorded` — a UI desenha a mesma linha do tempo em todos os
    // casos e marca a cinzento o que não foi gravado.
    stages: [
      {
        key: 'input',
        label: 'Entrada',
        recorded: true,
        value: { job: run.job_name, tenant: run.tenant_name || 'Plataforma (todas as clínicas)' },
      },
      { key: 'context', label: 'Contexto recolhido', recorded: false, value: null },
      { key: 'decision', label: 'Decisão', recorded: false, value: null },
      { key: 'tools', label: 'Ferramentas usadas', recorded: false, value: null },
      {
        key: 'actions',
        label: 'Ações',
        // Cada chave de `details` é uma sub-tarefa que a passagem executou.
        recorded: Object.keys(details).filter((k) => k !== 'error').length > 0,
        value: Object.keys(details).filter((k) => k !== 'error'),
      },
      {
        key: 'result',
        label: 'Resultado',
        recorded: true,
        value: run.status === 'failed' ? { error: details.error } : details,
      },
      {
        key: 'evaluation',
        label: 'Avaliação',
        recorded: false,
        value: insights ? { insightsProduzidos: insights.n } : null,
      },
    ],
    missingStages: ['context', 'decision', 'tools', 'evaluation'],
  });
});
