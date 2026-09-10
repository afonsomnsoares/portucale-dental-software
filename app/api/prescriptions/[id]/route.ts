import { appendAudit, appendTimeline } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const PUT = withRoute<{ id: string }>(
  { permission: 'prescriptions:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;
    const body = await request.json();

    const tenantId = user.tenantId;
    const prev = await queryOne(
      `SELECT * FROM prescriptions WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await query(
      `UPDATE prescriptions
     SET medication=$1, dosage=$2, frequency=$3, route=$4, duration=$5,
         quantity=$6, refills=$7, instructions=$8, notes=$9, updated_at=NOW()
     WHERE id=$10 AND ($11::uuid IS NULL OR tenant_id=$11::uuid) RETURNING *`,
      [
        body.medication ?? prev.medication,
        body.dosage ?? prev.dosage,
        body.frequency ?? prev.frequency,
        body.route ?? prev.route,
        body.duration ?? prev.duration,
        body.quantity ?? prev.quantity,
        body.refills ?? prev.refills,
        body.instructions ?? prev.instructions,
        body.notes ?? prev.notes,
        id,
        tenantId,
      ],
    );

    await appendAudit(
      user,
      'UPDATE',
      `Prescription: ${updated.medication}`,
      `status:${prev.status}`,
      `status:${updated.status}`,
      user.clinic,
    );

    return Response.json(updated);
  },
);

export const DELETE = withRoute<{ id: string }>(
  { permission: 'prescriptions:manage', tenant: 'optional' },
  async ({ user, params }) => {
    const { id } = params;
    const tenantId = user.tenantId;

    const prev = await queryOne(
      `SELECT * FROM prescriptions WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await query(
      `UPDATE prescriptions SET status='cancelled', updated_at=NOW()
     WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) RETURNING *`,
      [id, tenantId],
    );

    await appendTimeline(prev.patient_id, user, 'clinical', `Prescrição cancelada: ${prev.medication}`);
    await appendAudit(user, 'DELETE', `Prescription: ${prev.medication}`, 'active', 'cancelled', user.clinic);

    return Response.json(updated);
  },
);
