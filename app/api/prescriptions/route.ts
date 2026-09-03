import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asInt, sanitizeString } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'prescriptions:read'))) return forbidden();
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');

  let sql = `SELECT p.*, pat.name AS patient_name
             FROM prescriptions p
             JOIN patients pat ON pat.id = p.patient_id
             WHERE 1=1`;
  const vals = [];
  if (patientId) {
    vals.push(patientId);
    sql += ` AND p.patient_id=$${vals.length}`;
  }
  if (user.tenantId) {
    vals.push(user.tenantId);
    sql += ` AND p.tenant_id=$${vals.length}`;
  }
  sql += ' ORDER BY p.created_at DESC';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'prescriptions:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const body = await request.json();
  const { patientId, medication, dosage, frequency, route, duration, quantity, refills, instructions, notes } = body;

  if (!patientId || !medication) {
    return Response.json({ error: 'patientId and medication required' }, { status: 400 });
  }

  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const [row] = await query(
    `INSERT INTO prescriptions
       (tenant_id, patient_id, medication, dosage, frequency, route, duration, quantity, refills, instructions, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)
     RETURNING *`,
    [
      user.tenantId,
      patientId,
      sanitizeString(medication, 200),
      sanitizeString(dosage, 100),
      sanitizeString(frequency, 100),
      sanitizeString(route, 50),
      sanitizeString(duration, 100),
      asInt(quantity, { min: 0, max: 100000 }) ?? 0,
      asInt(refills, { min: 0, max: 99 }) ?? 0,
      sanitizeString(instructions, 2000),
      sanitizeString(notes, 2000),
      user.id,
    ],
  );

  await appendTimeline(patientId, user, 'clinical', `Prescrição criada: ${medication} ${dosage} ${frequency}`);
  await appendAudit(user, 'CREATE', `Prescription: ${medication}`, null, 'active', user.clinic);

  return Response.json(row, { status: 201 });
}
