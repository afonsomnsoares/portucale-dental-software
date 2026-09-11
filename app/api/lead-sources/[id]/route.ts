import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';

// Activate/deactivate a lead capture source — the only mutation this identity supports
// (no rename, no token rotation for now: rotating would mean generating + returning a
// new token, which is just "create a new source" with extra steps, so callers who want a
// new token create a new source and deactivate the old one instead).
export const PUT = withRoute<{ id: string }>(
  { permission: 'lead-sources:manage', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    // super_admin (no tenantId of their own) isn't restricted to one tenant here — same
    // idiom as app/api/patients/[id]/route.ts's PUT.

    const prev = await queryOne(
      `SELECT * FROM lead_capture_sources WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return notFound('Lead capture source not found');

    const body = await request.json();
    if (typeof body.active !== 'boolean') {
      return Response.json({ error: 'active (boolean) is required' }, { status: 400 });
    }

    const [row] = await query(
      `UPDATE lead_capture_sources SET active=$1
     WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id=$3::uuid)
     RETURNING id, tenant_id, label, token_prefix, active, created_by, created_at, updated_at, last_used_at, lead_count`,
      [body.active, id, tenantId],
    );

    await appendAudit(
      user,
      'UPDATE',
      `Lead capture source: ${prev.label}`,
      `active:${prev.active}`,
      `active:${row.active}`,
      user.clinic,
    );

    return Response.json(row);
  },
);
