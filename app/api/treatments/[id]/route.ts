import { appendAudit, appendTimeline } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

// GET /api/treatments/[id]
export const GET = withRoute<{ id: string }>(
  { permission: 'treatments:read', tenant: 'required' },
  async ({ params, tenantId }) => {
    const { id } = params;
    const t = await queryOne(
      `SELECT t.*, p.name as patient_name FROM treatments t
     JOIN patients p ON p.id=t.patient_id
     WHERE t.id=$1 AND ($2::uuid IS NULL OR t.tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!t) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(t);
  },
);

// PUT /api/treatments/[id]  — full update (receptionist or dentist)
export const PUT = withRoute<{ id: string }>(
  { permission: 'treatments:update', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    const body = await request.json();
    const prev = await queryOne(`SELECT * FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
      id,
      tenantId,
    ]);
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    if (body.status !== undefined) {
      const allowed = ['proposed', 'accepted', 'completed'];
      if (!allowed.includes(body.status)) return Response.json({ error: 'Invalid status' }, { status: 400 });
    }

    const [updated] = await query(
      `UPDATE treatments
     SET treatment_code=$1, description=$2, phase=$3,
         status=$4, fee=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
      [
        body.treatmentCode ?? prev.treatment_code,
        body.description ?? prev.description,
        body.phase ?? prev.phase,
        body.status ?? prev.status,
        body.fee ?? prev.fee,
        body.notes ?? prev.notes,
        id,
      ],
    );

    if (body.status && body.status !== prev.status) {
      await appendTimeline(
        prev.patient_id,
        user,
        'clinical',
        `Tratamento "${updated.description}" estado: ${prev.status} → ${updated.status}`,
      );
    }
    await appendAudit(
      user,
      'UPDATE',
      `Treatment: ${updated.description}`,
      `status:${prev.status} fee:${prev.fee}`,
      `status:${updated.status} fee:${updated.fee}`,
      user.clinic,
    );

    return Response.json(updated);
  },
);

// DELETE /api/treatments/[id]
export const DELETE = withRoute<{ id: string }>(
  { permission: 'treatments:delete', tenant: 'required' },
  async ({ user, params, tenantId }) => {
    const { id } = params;
    const prev = await queryOne(`SELECT * FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
      id,
      tenantId,
    ]);
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });
    await query(`DELETE FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [id, tenantId]);
    await appendAudit(user, 'DELETE', `Treatment: ${prev.description}`, prev.status, null, user.clinic);
    return Response.json({ deleted: true });
  },
);
