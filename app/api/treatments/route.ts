import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asFee, requireFields, validateTreatmentBody } from '@/lib/validate';

// GET /api/treatments?patientId=&status=
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  // Ler exige 'treatments:read', não as três ações de escrita. Exigir escrita para
  // ler mantinha a rececionista fora de uma página que o menu lhe oferece.
  if (!(await hasPermission(user, 'treatments:read'))) return forbidden();
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  const status = searchParams.get('status');

  let sql = `SELECT t.*, p.name as patient_name
             FROM treatments t JOIN patients p ON p.id = t.patient_id
             WHERE 1=1`;
  const vals = [];
  if (patientId) {
    vals.push(patientId);
    sql += ` AND t.patient_id=$${vals.length}`;
  }
  if (status) {
    vals.push(status);
    sql += ` AND t.status=$${vals.length}`;
  }
  // Tenant scope for non-admins
  if (user.tenantId) {
    vals.push(user.tenantId);
    sql += ` AND t.tenant_id=$${vals.length}`;
  }
  sql += ' ORDER BY t.phase, t.created_at';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

// POST /api/treatments
export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'treatments:create'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const body = await request.json();
  const missing = requireFields(body, ['patientId', 'description']);
  if (missing.length)
    return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
  const treatmentErrors = validateTreatmentBody(body);
  if (treatmentErrors) return Response.json({ error: treatmentErrors.join('; ') }, { status: 400 });

  const { patientId, treatmentCode, description, phase, fee, notes } = body;

  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const [t] = await query(
    `INSERT INTO treatments (tenant_id, patient_id, treatment_code, description, phase, status, fee, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,'proposed',$6,$7,$8)
     RETURNING *`,
    [
      user.tenantId,
      patientId,
      String(treatmentCode || '').slice(0, 30),
      String(description).slice(0, 500),
      phase || 1,
      asFee(fee) ?? 0,
      String(notes || '').slice(0, 2000) || null,
      user.id,
    ],
  );

  await appendTimeline(patientId, user, 'clinical', `Tratamento proposto: ${description} — €${fee}`);
  await appendAudit(user, 'CREATE', `Tratamento: ${description}`, null, 'proposto', user.clinic);

  return Response.json(t, { status: 201 });
}
