import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeClinicSummary } from '@/lib/reports';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'reports:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const from = clampDate(searchParams.get('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(searchParams.get('to')) || new Date().toISOString().slice(0, 10);

  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'admin' && !user.tenantId ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const summary = await computeClinicSummary(tenantId, from, to);
  if (!summary) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json(summary);
}
