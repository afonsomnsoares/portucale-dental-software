import { forbidden, scopeTenant } from '@/lib/auth';
import { computeClinicSummary } from '@/lib/reports';
import { withRoute } from '@/lib/route';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export const GET = withRoute({ permission: 'reports:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const from = clampDate(searchParams.get('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(searchParams.get('to')) || new Date().toISOString().slice(0, 10);

  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const summary = await computeClinicSummary(tenantId, from, to);
  if (!summary) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json(summary);
});
