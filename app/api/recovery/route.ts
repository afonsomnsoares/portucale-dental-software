import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { computeRecovery } from '@/lib/recovery';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'recovery:read'))) return forbidden();

  const requestedTenantId = new URL(request.url).searchParams.get('tenantId');
  const tenantId = user.role === 'admin' && !user.tenantId ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const tenant = await queryOne(`SELECT id, name, operatories FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return Response.json({ error: 'Not found' }, { status: 404 });

  const [recovery, snapshots] = await Promise.all([
    computeRecovery(tenantId),
    query(
      `SELECT snapshot_month, total_estimated
       FROM recovery_snapshots WHERE tenant_id=$1
       ORDER BY snapshot_month DESC LIMIT 12`,
      [tenantId],
    ),
  ]);

  return Response.json({
    tenant: { id: tenant.id, name: tenant.name, operatories: Number(tenant.operatories || 1) },
    generatedAt: new Date().toISOString(),
    total: recovery.total,
    categories: recovery.categories,
    snapshots,
  });
}
