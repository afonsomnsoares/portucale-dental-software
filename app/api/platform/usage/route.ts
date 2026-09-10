import { queryRead, warnSchemaGap } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Utilização real por clínica — o que substitui "Usage" e "Retention" enquanto não
// houver telemetria de produto (sessões, ecrãs vistos, DAU/MAU).
//
// O que dá para medir com o que já está gravado: quantos doentes, quantos
// utilizadores ativos, quantas marcações nos últimos 30 dias e QUANDO foi a última
// atividade da clínica. A última é a que interessa para retenção: uma clínica sem
// marcações há semanas está a sair, quer o contrato diga o que disser.
export const GET = withRoute({ platform: 'reports:read', tenant: 'optional' }, async () => {
  try {
    const rows = await queryRead(
      `SELECT t.id, t.name, t.city, t.status, t.created_at, t.operatories,
              (SELECT COUNT(*)::int FROM patients p WHERE p.tenant_id = t.id) AS patients,
              (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.active) AS active_users,
              (SELECT COUNT(*)::int FROM appointments a
                WHERE a.tenant_id = t.id AND a.appt_date > CURRENT_DATE - 30) AS appts_30d,
              (SELECT COUNT(*)::int FROM appointments a
                WHERE a.tenant_id = t.id AND a.appt_date > CURRENT_DATE - 60
                  AND a.appt_date <= CURRENT_DATE - 30) AS appts_prev_30d,
              (SELECT MAX(a.appt_date) FROM appointments a WHERE a.tenant_id = t.id) AS last_appointment,
              (SELECT COUNT(*)::int FROM job_runs r
                WHERE r.tenant_id = t.id AND r.started_at > NOW() - INTERVAL '7 days') AS agent_runs_7d
         FROM tenants t
        ORDER BY t.name`,
    );
    return Response.json(rows);
  } catch (e) {
    warnSchemaGap('platform.usage', e);
    return Response.json([]);
  }
});
