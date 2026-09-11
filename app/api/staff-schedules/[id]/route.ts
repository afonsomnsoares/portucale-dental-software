import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';

export const DELETE = withRoute<{ id: string }>(
  { permission: 'staff-schedules:manage', tenant: 'required' },
  async ({ user, params, tenantId }) => {
    const { id } = params;
    // super_admin (no tenantId of their own) isn't restricted to one tenant here — same
    // idiom as app/api/lead-sources/[id]/route.ts.

    const prev = await queryOne(
      `SELECT s.*, u.name AS user_name FROM staff_schedules s JOIN users u ON u.id = s.user_id
     WHERE s.id=$1 AND ($2::uuid IS NULL OR s.tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return notFound('Shift not found');

    await query(`DELETE FROM staff_schedules WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [id, tenantId]);

    await appendAudit(
      user,
      'DELETE',
      `Staff schedule: ${prev.user_name}`,
      `weekday ${prev.weekday} ${prev.start_time}-${prev.end_time}`,
      null,
      user.clinic,
    );

    return Response.json({ ok: true });
  },
);
