import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { revalidateSession } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  // A sessão pode ter sido desativada, despromovida ou movida de clínica depois de o
  // token ser assinado; revalidateSession() confirma-o contra `users` e realinha
  // user.role/user.tenantId. Ver lib/permissions.ts.
  if (!(await revalidateSession(user))) return unauthorized();
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
}
