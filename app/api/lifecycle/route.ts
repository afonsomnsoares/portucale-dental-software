import { queryOne } from '@/lib/db';
import { computeLifecycleTransitions } from '@/lib/lifecycle';
import { computeJourneyPipeline } from '@/lib/patientJourney';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'lifecycle:read', tenant: 'required' }, async ({ tenantId }) => {
  const tenant = await queryOne(`SELECT id FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return Response.json({ error: 'Not found' }, { status: 404 });

  // `leads` deixou de vir à parte: os leads abertos são a primeira etapa de `stages`
  // desde que JOURNEY_STAGES passou a incluí-los (ver lib/patientJourneyCalc.ts). Uma
  // lista paralela era a mesma informação com outra contagem — e a contagem da lista
  // estava truncada.
  const [{ stages }, { outreachCandidates }] = await Promise.all([
    computeJourneyPipeline(tenantId),
    // Item 7's segmentação: same candidates lib/jobsRunner.ts's queueLifecycleOutreach
    // acts on, surfaced here read-only so staff can see who's overdue for reactivation
    // and why (dormancy/value) before — or instead of — the automated SMS.
    computeLifecycleTransitions(tenantId),
  ]);

  return Response.json({
    generatedAt: new Date().toISOString(),
    stages,
    reactivationCandidates: outreachCandidates.map((c) => ({
      patientId: c.patientId,
      name: c.name,
      phone: c.phone,
      segment: c.segment,
    })),
  });
});
