import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asFee, sanitizeString } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');

  let sql = `SELECT tp.*, p.name AS patient_name
             FROM treatment_plans tp
             JOIN patients p ON p.id = tp.patient_id
             WHERE 1=1`;
  const vals = [];
  if (patientId) {
    vals.push(patientId);
    sql += ` AND tp.patient_id=$${vals.length}`;
  }
  if (user.tenantId) {
    vals.push(user.tenantId);
    sql += ` AND tp.tenant_id=$${vals.length}`;
  }
  sql += ' ORDER BY tp.created_at DESC';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!user.tenantId) return forbidden();
  const body = await request.json();
  const { patientId, title, description, phases, totalFee } = body;

  if (!patientId || !title) {
    return Response.json({ error: 'patientId and title required' }, { status: 400 });
  }

  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const [row] = await query(
    `INSERT INTO treatment_plans
       (tenant_id, patient_id, title, description, phases, total_fee, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      user.tenantId,
      patientId,
      sanitizeString(title, 200),
      sanitizeString(description, 2000),
      JSON.stringify(Array.isArray(phases) ? phases : []),
      asFee(totalFee) ?? 0,
      user.id,
    ],
  );

  await appendTimeline(patientId, user, 'clinical', `Plano de tratamento criado: ${title}`);
  await appendAudit(user, 'CREATE', `Treatment plan: ${title}`, null, `$${totalFee || 0}`, user.clinic);

  return Response.json(row, { status: 201 });
}
