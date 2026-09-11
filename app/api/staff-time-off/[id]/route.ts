import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { withRoute } from '@/lib/route';
import { asEnum } from '@/lib/validate';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// Approve/reject a pending request requires 'staff-time-off:manage'. Cancelling your own
// still-pending request is self-service (no permission needed) — same reasoning as
// app/api/waitlist/[id]/route.ts letting a receptionist cancel an entry without a
// separate "cancel" permission: it's undoing your own action, not managing someone else's.
export const PUT = withRoute<{ id: string }>(
  {
    authOnly: 'Mesma regra do POST em ../route.ts: o corpo confina a alteração à clínica de quem chama',
    tenant: 'required',
  },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    // super_admin (no tenantId of their own) isn't restricted to one tenant here — same
    // idiom as app/api/lead-sources/[id]/route.ts. A tenant-scoped user (including one
    // cancelling their own request) is still confined to their own tenant as before.
    if (!tenantId && user.role !== 'super_admin') return forbidden();

    const prev = await queryOne(
      `SELECT * FROM staff_time_off WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return notFound('Time off request not found');

    const body = await request.json();
    const status = asEnum(body.status, STATUSES);
    if (!status) return Response.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });

    const isOwnCancel = status === 'cancelled' && prev.user_id === user.id && prev.status === 'pending';
    if (!isOwnCancel && !(await hasPermission(user, 'staff-time-off:manage'))) return forbidden();

    const approving = status === 'approved' || status === 'rejected';
    const [row] = await query(
      `UPDATE staff_time_off
     SET status=$1, approved_by=$2, approved_at=$3
     WHERE id=$4 AND ($5::uuid IS NULL OR tenant_id=$5::uuid)
     RETURNING *`,
      [
        status,
        approving ? user.id : prev.approved_by,
        approving ? new Date().toISOString() : prev.approved_at,
        id,
        tenantId,
      ],
    );

    await appendAudit(user, 'UPDATE', `Time off request`, `status:${prev.status}`, `status:${row.status}`, user.clinic);

    return Response.json(row);
  },
);
