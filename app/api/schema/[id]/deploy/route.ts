import type { NextRequest } from 'next/server';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
  if (!(await hasPermission(user, 'schema:manage'))) return forbidden();
  const { id } = await params;

  // Same tenant-ownership rule as PUT /api/schema/[id] — see the comment there.
  const existing = await queryOne(`SELECT tenant_id, field_name FROM schema_fields WHERE id=$1`, [id]);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
  if (user.tenantId && existing.tenant_id !== user.tenantId) {
    await logBlockedAccess(user, `Schema field ${id} (${existing.field_name}): cross-tenant deploy blocked`);
    return forbidden();
  }

  const [f] = await query(`UPDATE schema_fields SET rollout=100, pushed_at=CURRENT_DATE WHERE id=$1 RETURNING *`, [id]);
  if (!f) return Response.json({ error: 'Not found' }, { status: 404 });
  await appendAudit(user, 'UPDATE', `Schema field: ${f.field_name} deployed`, '0%', '100%');
  return Response.json(f);
}
