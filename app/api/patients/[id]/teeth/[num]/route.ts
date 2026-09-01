import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { getOwnedPatient } from '@/lib/tenantGuard';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; num: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'dentist', 'admin', 'super_admin')) return forbidden();
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const { id, num } = await params;
  const body = await request.json();
  const { condition, surfaces, notes } = body;

  if (!(await getOwnedPatient(id, user))) return Response.json({ error: 'Patient not found' }, { status: 404 });

  const [prev] = await query(`SELECT condition FROM teeth WHERE patient_id=$1 AND tooth_num=$2`, [id, num]);
  const before = prev?.condition || 'healthy';

  const [row] = await query(
    `INSERT INTO teeth (patient_id, tooth_num, condition, surfaces, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (patient_id, tooth_num)
     DO UPDATE SET condition=$3, surfaces=$4, notes=$5, updated_by=$6, updated_at=NOW()
     RETURNING *`,
    [id, num, condition, surfaces || [], notes || null, user.id],
  );

  await appendTimeline(id, user, 'clinical', `Dente #${num} atualizado: ${before} → ${condition}`);
  await appendAudit(user, 'UPDATE', `Patient tooth #${num}`, before, condition, user.clinic);

  return Response.json(row);
}
