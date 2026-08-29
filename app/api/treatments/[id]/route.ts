import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

// GET /api/treatments/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (
    !(await hasPermission(user, 'treatments:update')) &&
    !(await hasPermission(user, 'treatments:create')) &&
    !(await hasPermission(user, 'treatments:delete'))
  )
    return forbidden();
  const { id } = await params;
  const tenantId = user.role === 'admin' && !user.tenantId ? null : user.tenantId;
  const t = await queryOne(
    `SELECT t.*, p.name as patient_name FROM treatments t
     JOIN patients p ON p.id=t.patient_id
     WHERE t.id=$1 AND ($2::uuid IS NULL OR t.tenant_id=$2::uuid)`,
    [id, tenantId],
  );
  if (!t) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(t);
}

// PUT /api/treatments/[id]  — full update (receptionist or dentist)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'treatments:update'))) return forbidden();
  const { id } = await params;
  const body = await request.json();
  const tenantId = user.role === 'admin' && !user.tenantId ? null : user.tenantId;
  const prev = await queryOne(`SELECT * FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    tenantId,
  ]);
  if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

  const [updated] = await query(
    `UPDATE treatments
     SET tooth_num=$1, treatment_code=$2, description=$3, phase=$4,
         status=$5, fee=$6, notes=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [
      body.toothNum ?? prev.tooth_num,
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
}

// DELETE /api/treatments/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'treatments:delete'))) return forbidden();
  const { id } = await params;
  const tenantId = user.role === 'admin' && !user.tenantId ? null : user.tenantId;
  const prev = await queryOne(`SELECT * FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    tenantId,
  ]);
  if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });
  await query(`DELETE FROM treatments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [id, tenantId]);
  await appendAudit(user, 'DELETE', `Treatment: ${prev.description}`, prev.status, null, user.clinic);
  return Response.json({ deleted: true });
}
