import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();

  const filter = user.tenantId ? 'WHERE tenant_id=$1' : '';
  const params = user.tenantId ? [user.tenantId] : [];

  const [clinics] = await query(`SELECT COUNT(*) FROM tenants WHERE status='active'`);
  const [patients] = await query(`SELECT COUNT(*) FROM patients ${filter}`, params);
  const [outstanding] = await query(`SELECT COALESCE(SUM(balance),0) as total FROM patients ${filter}`, params);
  const [highRisk] = await query(
    `SELECT COUNT(*)::int AS count
     FROM appointments a JOIN patients p ON p.id=a.patient_id
     WHERE a.appt_date=CURRENT_DATE ${user.tenantId ? 'AND a.tenant_id=$1' : ''}
       AND (ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100) >= 60)`,
    user.tenantId ? [user.tenantId] : [],
  );
  const [tenants] = await query(`SELECT COUNT(*) FROM tenants`);

  return Response.json({
    activeClinics: Number(clinics.count),
    totalTenants: Number(tenants.count),
    totalPatients: Number(patients.count),
    outstanding: Number(outstanding.total),
    highRisk: Number(highRisk.count),
  });
}
