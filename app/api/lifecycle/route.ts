import { forbidden, scopeTenant } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { computeLifecycleTransitions, listOpenLeads } from '@/lib/lifecycle';
import { computeJourneyPipeline } from '@/lib/patientJourney';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'lifecycle:read', tenant: 'optional' }, async ({ request, user }) => {
  const requestedTenantId = new URL(request.url).searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const tenant = await queryOne(`SELECT id FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return Response.json({ error: 'Not found' }, { status: 404 });

  const [{ stages }, leads, { outreachCandidates }] = await Promise.all([
    computeJourneyPipeline(tenantId),
    listOpenLeads(tenantId),
    // Item 7's segmentação: same candidates lib/jobsRunner.ts's queueLifecycleOutreach
    // acts on, surfaced here read-only so staff can see who's overdue for reactivation
    // and why (dormancy/value) before — or instead of — the automated SMS.
    computeLifecycleTransitions(tenantId),
  ]);

  return Response.json({
    generatedAt: new Date().toISOString(),
    leads,
    stages,
    reactivationCandidates: outreachCandidates.map((c) => ({
      patientId: c.patientId,
      name: c.name,
      phone: c.phone,
      segment: c.segment,
    })),
  });
});
