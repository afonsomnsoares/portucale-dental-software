import { appendAudit } from '../audit';
import type { SessionUser } from '../auth';
import { query } from '../db';
import type { ClampedInsight } from './insightCalc';

// Escrita partilhada dos agentes de análise em agent_insights (migração 041).
//
// Cada corrida substitui os insights ainda por tratar do mesmo agente: o que o agente
// diz é uma leitura do estado de agora, não um histórico a acumular — sem isto, a
// página enchia-se do mesmo aviso repetido a cada passagem do cron. Os já resolvidos
// (resolved_at preenchido) nunca são tocados: esses são o histórico.
export async function replaceOpenInsights(
  tenantId: string | null,
  agentId: string,
  insights: readonly ClampedInsight[],
  actor: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'>,
) {
  if (tenantId) {
    await query(`DELETE FROM agent_insights WHERE tenant_id=$1 AND agent_id=$2 AND resolved_at IS NULL`, [
      tenantId,
      agentId,
    ]);
  } else {
    await query(`DELETE FROM agent_insights WHERE tenant_id IS NULL AND agent_id=$1 AND resolved_at IS NULL`, [
      agentId,
    ]);
  }

  for (const i of insights) {
    await query(
      `INSERT INTO agent_insights (tenant_id, agent_id, kind, severity, title, body, impact_eur, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [tenantId, agentId, i.kind, i.severity, i.title, i.body, i.impactEur, JSON.stringify({})],
    );
  }

  if (insights.length) {
    await appendAudit(
      actor,
      'CREATE',
      `${actor.name}: ${insights.length} ${insights.length === 1 ? 'conclusão' : 'conclusões'}`,
      null,
      insights.map((i) => i.severity).join(', '),
      actor.clinic,
    );
  }
  return { insights: insights.length };
}

/** O ator que aparece no audit_log por cada agente de análise. */
export function aiActor(agentName: string): Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> {
  return { id: '', name: `Agente IA — ${agentName}`, role: 'system', clinic: 'System' };
}
