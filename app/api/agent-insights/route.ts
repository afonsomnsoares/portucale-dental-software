import { query, queryOne, queryRead } from '@/lib/db';
import { badRequest, notFound, ok } from '@/lib/http';
import { withRoute } from '@/lib/route';

// As conclusões que os agentes de análise escrevem (agent_insights, migração 041).
//
// O agente Grupo escreve com tenant_id NULL, porque compara clínicas e não pertence a
// nenhuma. Por isso o GET junta os dois casos consoante quem pergunta: uma clínica vê o
// que é dela; o super-admin vê o dela (se escolher uma) mais o de plataforma. A RLS da
// migração 041 impede o resto de qualquer maneira — isto só evita pedir o que não se
// pode ver.
export const GET = withRoute({ permission: 'agents:read', tenant: 'optional' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');
  const includeResolved = searchParams.get('includeResolved') === '1';

  const conds: string[] = [];
  const vals: unknown[] = [];

  if (tenantId) {
    vals.push(tenantId);
    conds.push(`tenant_id = $${vals.length}`);
  } else {
    // Super-admin sem clínica escolhida: vê o que é de plataforma (o agente Grupo).
    conds.push(`tenant_id IS NULL`);
  }
  if (agentId) {
    vals.push(agentId);
    conds.push(`agent_id = $${vals.length}`);
  }
  if (!includeResolved) conds.push(`resolved_at IS NULL`);

  const rows = await queryRead(
    `SELECT id, tenant_id, agent_id, kind, severity, title, body, impact_eur, resolved_at, created_at
     FROM agent_insights
     WHERE ${conds.join(' AND ')}
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       COALESCE(impact_eur, 0) DESC,
       created_at DESC
     LIMIT 100`,
    vals,
  );
  return ok(rows);
});

// Marcar como tratada. Não apaga: o insight fica no histórico com quem o fechou e
// quando — a próxima corrida do agente só substitui os que continuam por tratar (ver
// replaceOpenInsights em lib/agents/insights.ts).
export const PATCH = withRoute({ permission: 'agents:resolve', tenant: 'optional' }, async ({ request, user }) => {
  const body = await request.json().catch(() => ({}));
  const id = String((body as { id?: unknown }).id || '');
  if (!id) return badRequest('id is required');

  // A RLS já impede fechar o insight de outra clínica; este SELECT é o que transforma
  // isso num 404 honesto em vez de um UPDATE silencioso que não faz nada.
  const existing = await queryOne(`SELECT id FROM agent_insights WHERE id=$1`, [id]);
  if (!existing) return notFound('Insight not found');

  const [row] = await query(`UPDATE agent_insights SET resolved_at=NOW(), resolved_by=$1 WHERE id=$2 RETURNING *`, [
    user.id || null,
    id,
  ]);
  return ok(row);
});
