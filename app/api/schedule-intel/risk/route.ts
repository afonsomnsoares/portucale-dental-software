import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { computeUpcomingRisk } from '@/lib/scheduleIntel';

export const GET = withRoute({ permission: 'schedule:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const { scored, highRisk } = await computeUpcomingRisk(tenantId, days);

  // ─── Os substitutos que o job já escolheu ─────────────────────────────────
  // O pedido de confirmação a uma consulta de risco (tarefa 'riskOutreach' em
  // lib/jobsRunner.ts) guarda no payload quem, da lista de espera, podia ficar com o lugar
  // se o doente faltar. Ficava gravado e ninguém o via; é aqui, ao lado do risco, que a
  // receção decide a quem ligar.
  const ids = scored.map((a) => a.id);
  const standbyRows = ids.length
    ? await query(
        `SELECT DISTINCT ON (appointment_id) appointment_id, payload->'standbyCandidates' AS standby
           FROM notifications
          WHERE tenant_id=$1 AND appointment_id = ANY($2::uuid[]) AND payload->>'kind'='risk_outreach'
          ORDER BY appointment_id, created_at DESC`,
        [tenantId, ids],
      )
    : [];
  const standbyById = new Map(
    standbyRows.map((r) => [String(r.appointment_id), Array.isArray(r.standby) ? r.standby : []]),
  );
  const withStandby = <T extends { id: string }>(a: T) => ({ ...a, standby: standbyById.get(String(a.id)) || [] });

  return Response.json({
    generatedAt: new Date().toISOString(),
    days,
    appointments: scored.map(withStandby),
    highRisk: highRisk.map(withStandby),
  });
});
