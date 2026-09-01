import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { sanitizeString } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');

  let sql = `SELECT cf.*, p.name AS patient_name
             FROM consent_forms cf
             JOIN patients p ON p.id = cf.patient_id
             WHERE 1=1`;
  const vals = [];
  if (patientId) {
    vals.push(patientId);
    sql += ` AND cf.patient_id=$${vals.length}`;
  }
  if (user.tenantId) {
    vals.push(user.tenantId);
    sql += ` AND cf.tenant_id=$${vals.length}`;
  }
  sql += ' ORDER BY cf.created_at DESC';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!user.tenantId) return unauthorized();
  const body = await request.json();
  const { patientId, procedureName, description, signedBy, signatureUrl, storageKey, fileSize } = body;

  if (!patientId || !procedureName) {
    return Response.json({ error: 'patientId and procedureName required' }, { status: 400 });
  }

  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  // There's no separate status column: `signed_by` empty means "not signed yet" — staff
  // can now create the row before the signature exists too (signedBy omitted), so the
  // patient can complete it remotely through their portal link (see
  // app/api/public/patient-portal/[token]/route.ts's POST for the consent_form purpose),
  // instead of only the presencial flow where staff already have the signature in hand.
  const signedByClean = sanitizeString(signedBy, 200);
  const isPending = !signedByClean;

  const [row] = await query(
    `INSERT INTO consent_forms
       (tenant_id, patient_id, procedure_name, description, signed_by, signature_url, storage_key, file_size, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      user.tenantId,
      patientId,
      sanitizeString(procedureName, 200),
      sanitizeString(description, 2000),
      signedByClean,
      sanitizeString(signatureUrl, 2000),
      sanitizeString(storageKey, 500),
      Number.isFinite(Number(fileSize)) ? Math.max(0, Math.trunc(Number(fileSize))) : 0,
      user.id,
    ],
  );

  await appendTimeline(
    patientId,
    user,
    'admin',
    isPending
      ? `Formulário de consentimento pedido: ${procedureName}`
      : `Formulário de consentimento assinado: ${procedureName}`,
  );
  await appendAudit(user, 'CREATE', `Consent form: ${procedureName}`, null, `patient:${patientId}`, user.clinic);

  return Response.json(row, { status: 201 });
}
