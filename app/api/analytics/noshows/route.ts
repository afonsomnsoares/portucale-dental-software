import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute(
  {
    authOnly:
      'LACUNA CONHECIDA: devolve nome e telefone de doentes em risco de faltar, ' +
      'e qualquer sessão autenticada da clínica lê. Provavelmente devia exigir schedule:read',
    tenant: 'optional',
  },
  async ({ user }) => {
    const rows = await query(
      `SELECT a.id, a.patient_name, a.type, a.start_time, a.status, a.chair,
            ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100)::int AS risk_score,
            p.phone
     FROM appointments a JOIN patients p ON p.id=a.patient_id
     WHERE a.appt_date=CURRENT_DATE
       AND ($1::uuid IS NULL OR a.tenant_id=$1::uuid)
     ORDER BY ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100) DESC NULLS LAST`,
      [user.tenantId || null],
    );
    const highRisk = rows.filter((r) => (r.risk_score || 0) >= 60);
    return Response.json({ all: rows, highRisk, highRiskCount: highRisk.length });
  },
);
