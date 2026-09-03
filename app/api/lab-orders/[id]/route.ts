import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

const VALID_TRANSITIONS = {
  ordered: ['sent'],
  sent: ['in-progress'],
  'in-progress': ['received'],
};

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'lab-orders:manage'))) return forbidden();
  const { id } = await params;
  const body = await request.json();

  const tenantId = user.tenantId;
  const prev = await queryOne(`SELECT * FROM lab_orders WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    tenantId,
  ]);
  if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

  const newStatus = body.status || prev.status;
  if (body.status && body.status !== prev.status) {
    const allowed = (VALID_TRANSITIONS as Record<string, string[]>)[prev.status];
    if (!allowed?.includes(body.status)) {
      return Response.json(
        {
          error: `Cannot transition from '${prev.status}' to '${body.status}'`,
        },
        { status: 400 },
      );
    }
  }

  const isReceived = newStatus === 'received';

  const [updated] = await query(
    `UPDATE lab_orders
     SET lab_name=$1, case_type=$2, description=$3,
         instructions=$4, due_date=$5, fee=$6, status=$7,
         received_by=$8, received_at=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`,
    [
      body.labName ?? prev.lab_name,
      body.caseType ?? prev.case_type,
      body.description ?? prev.description,
      body.instructions ?? prev.instructions,
      body.dueDate ?? prev.due_date,
      body.fee ?? prev.fee,
      newStatus,
      isReceived ? user.id : prev.received_by,
      isReceived ? new Date().toISOString() : prev.received_at,
      id,
    ],
  );

  if (body.status && body.status !== prev.status) {
    await appendTimeline(
      prev.patient_id,
      user,
      'clinical',
      `Estado da encomenda de laboratório: ${prev.status} → ${updated.status} — ${prev.lab_name}`,
    );
  }
  await appendAudit(
    user,
    'UPDATE',
    `Lab order: ${prev.lab_name}`,
    `status:${prev.status}`,
    `status:${updated.status}`,
    user.clinic,
  );

  return Response.json(updated);
}
