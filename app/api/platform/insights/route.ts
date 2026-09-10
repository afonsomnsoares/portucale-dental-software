import { queryRead, warnSchemaGap } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Alertas de toda a rede: agent_insights (migração 041) sem filtro de clínica.
// A RLS deixa passar porque o contexto da sessão é super_admin — ver
// enterTenantContext em lib/db.ts.
export const GET = withRoute({ platform: 'agents:read', tenant: 'optional' }, async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const severity = searchParams.get('severity');
  const openOnly = searchParams.get('open') !== '0';

  const vals: unknown[] = [];
  let where = 'WHERE 1=1';
  if (severity) {
    vals.push(severity);
    where += ` AND i.severity = $${vals.length}`;
  }
  if (openOnly) where += ' AND i.resolved_at IS NULL';

  try {
    const rows = await queryRead(
      `SELECT i.id, i.tenant_id, i.agent_id, i.kind, i.severity, i.title, i.body,
              i.impact_eur, i.created_at, i.resolved_at,
              t.name AS tenant_name, t.city AS tenant_city
         FROM agent_insights i
         LEFT JOIN tenants t ON t.id = i.tenant_id
         ${where}
        ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                 i.created_at DESC
        LIMIT 200`,
      vals,
    );
    return Response.json(rows);
  } catch (e) {
    warnSchemaGap('platform.insights', e);
    return Response.json([]);
  }
});
