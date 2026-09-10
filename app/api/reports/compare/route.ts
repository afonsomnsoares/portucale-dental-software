import { forbidden, requireRoles } from '@/lib/auth';
import { computeClinicComparison } from '@/lib/reports';
import { withRoute } from '@/lib/route';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Cross-clinic comparison only makes sense for the super_admin, managing several
// clinics — a single-clinic admin has nothing to compare against.
export const GET = withRoute({ permission: 'reports:read', tenant: 'optional' }, async ({ request, user }) => {
  if (!requireRoles(user, 'super_admin')) return forbidden();

  const { searchParams } = new URL(request.url);
  const from = clampDate(searchParams.get('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(searchParams.get('to')) || new Date().toISOString().slice(0, 10);

  const result = await computeClinicComparison(from, to);
  return Response.json(result);
});
