import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, requireRoles } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const PUT = withRoute<{ id: string }>(
  { permission: 'schema:manage', tenant: 'optional' },
  async ({ user, params, tenantId }) => {
    if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
    const { id } = params;

    // Same tenant-ownership rule as PUT /api/schema/[id] — see the comment there.
    const existing = await queryOne(`SELECT tenant_id, field_name FROM schema_fields WHERE id=$1`, [id]);
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
    if (tenantId && existing.tenant_id !== tenantId) {
      await logBlockedAccess(user, `Schema field ${id} (${existing.field_name}): cross-tenant deploy blocked`);
      return forbidden();
    }

    const [f] = await query(`UPDATE schema_fields SET rollout=100, pushed_at=CURRENT_DATE WHERE id=$1 RETURNING *`, [
      id,
    ]);
    if (!f) return Response.json({ error: 'Not found' }, { status: 404 });
    await appendAudit(user, 'UPDATE', `Schema field: ${f.field_name} deployed`, '0%', '100%');
    return Response.json(f);
  },
);
