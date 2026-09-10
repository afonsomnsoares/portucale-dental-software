import { appendAudit, appendTimeline } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute<{ id: string }>(
  { permission: 'treatment-plans:read', tenant: 'optional' },
  async ({ user, params }) => {
    const { id } = params;
    const tenantId = user.tenantId;

    const row = await queryOne(
      `SELECT tp.*, p.name AS patient_name
     FROM treatment_plans tp
     JOIN patients p ON p.id = tp.patient_id
     WHERE tp.id=$1 AND ($2::uuid IS NULL OR tp.tenant_id=$2::uuid)`,
      [id, tenantId],
    );

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(row);
  },
);

export const PUT = withRoute<{ id: string }>(
  { permission: 'treatment-plans:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;
    const body = await request.json();

    const tenantId = user.tenantId;
    const prev = await queryOne(
      `SELECT * FROM treatment_plans WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    let approved = prev.approved;
    let approvedAt = prev.approved_at;
    let approvedBy = prev.approved_by;

    if (body.approve === true && !prev.approved) {
      approved = true;
      approvedAt = new Date().toISOString();
      approvedBy = user.id;
    }

    const [updated] = await query(
      `UPDATE treatment_plans
     SET title=$1, description=$2, phases=$3::jsonb, total_fee=$4,
         approved=$5, approved_at=$6, approved_by=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
      [
        body.title ?? prev.title,
        body.description ?? prev.description,
        JSON.stringify(body.phases ?? prev.phases ?? []),
        body.totalFee ?? prev.total_fee,
        approved,
        approvedAt,
        approvedBy,
        id,
      ],
    );

    if (body.approve === true && !prev.approved) {
      await appendTimeline(prev.patient_id, user, 'clinical', `Plano de tratamento aprovado: ${updated.title}`);
    }
    await appendAudit(
      user,
      'UPDATE',
      `Treatment plan: ${prev.title}`,
      `approved:${prev.approved}`,
      `approved:${updated.approved}`,
      user.clinic,
    );

    return Response.json(updated);
  },
);
