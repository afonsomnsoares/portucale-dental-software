import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, requireRoles } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const PUT = withRoute<{ id: string }>(
  { permission: 'schema:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();

    const { id } = params;

    // schema_fields.tenant_id is nullable (NULL = global field). Only a super-admin
    // (no tenantId) may touch global fields or fields from another tenant; a tenant-scoped
    // admin may only edit their own tenant's fields.
    const existing = await queryOne(`SELECT tenant_id, field_name FROM schema_fields WHERE id=$1`, [id]);
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
    if (user.tenantId && existing.tenant_id !== user.tenantId) {
      await logBlockedAccess(user, `Schema field ${id} (${existing.field_name}): cross-tenant update blocked`);
      return forbidden();
    }

    const { label, description, required, enumValues, fieldType } = await request.json();
    const ev = Array.isArray(enumValues) ? enumValues.filter(Boolean).map(String) : null;
    const allowedTypes = new Set(['string', 'boolean', 'integer', 'decimal', 'enum', 'uuid_ref']);
    const nextType = fieldType && allowedTypes.has(String(fieldType)) ? String(fieldType) : null;
    const nextEnum = nextType && nextType !== 'enum' ? null : ev ? JSON.stringify(ev) : null;

    const [updated] = await query(
      `UPDATE schema_fields
     SET label=$1, description=$2, required=$3,
         field_type=COALESCE($4, field_type),
         enum_values=$5::jsonb
     WHERE id=$6
     RETURNING *`,
      [label || null, description || null, !!required, nextType, nextEnum, id],
    );

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    await appendAudit(user, 'UPDATE', `Schema field: ${updated.field_name}`, null, 'updated');
    return Response.json(updated);
  },
);
