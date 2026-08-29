import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireRoles, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeClinicComparison } from '@/lib/reports';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Cross-clinic comparison only makes sense for a global admin (no tenantId) managing
// several clinics — a single-clinic admin has nothing to compare against.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin') || user.tenantId) return forbidden();
  if (!(await hasPermission(user, 'reports:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const from = clampDate(searchParams.get('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(searchParams.get('to')) || new Date().toISOString().slice(0, 10);

  const result = await computeClinicComparison(from, to);
  return Response.json(result);
}
