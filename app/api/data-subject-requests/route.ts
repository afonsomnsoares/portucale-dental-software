import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asEnum, sanitizeString } from '@/lib/validate';

// Registo dos pedidos de exercício de direitos do titular (RGPD art. 15.º a 21.º).
// A tabela existia desde o schema inicial e nunca teve rota nenhuma — o pedido
// não tinha por onde entrar, e portanto o prazo de um mês do art. 12.º não tinha
// por onde ser contado. O cumprimento efetivo está em [id]/fulfil.
const REQUEST_TYPES = ['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'] as const;
const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'] as const;

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'gdpr:read'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const vals: unknown[] = [user.tenantId];
  let sql = `SELECT r.*, p.name AS patient_name, u.name AS resolved_by_name
             FROM data_subject_requests r
             LEFT JOIN patients p ON p.id = r.patient_id
             LEFT JOIN users u ON u.id = r.resolved_by
             WHERE r.tenant_id=$1`;
  if (status) {
    const valid = asEnum(status, STATUSES);
    if (!valid) return badRequest(`status must be one of: ${STATUSES.join(', ')}`);
    vals.push(valid);
    sql += ` AND r.status=$${vals.length}`;
  }
  // Os pendentes primeiro e os mais antigos no topo: a ordem em que o prazo
  // legal aperta é a ordem em que devem ser tratados.
  sql += ` ORDER BY (r.status = 'pending') DESC, r.created_at`;

  const rows = await query(sql, vals);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'gdpr:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Invalid request body');

  const requestType = asEnum(body.requestType, REQUEST_TYPES);
  if (!requestType) return badRequest(`requestType must be one of: ${REQUEST_TYPES.join(', ')}`);

  const patient = await getOwnedPatient(body.patientId, user);
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });

  const [row] = await query(
    `INSERT INTO data_subject_requests (tenant_id, patient_id, request_type, status, notes)
     VALUES ($1,$2,$3,'pending',$4)
     RETURNING *`,
    [user.tenantId, patient.id, requestType, sanitizeString(body.notes, 2000) || ''],
  );

  await appendTimeline(patient.id, user, 'admin', `Pedido RGPD registado: ${requestType}`);
  await appendAudit(user, 'CREATE', `RGPD request: ${requestType}`, null, `patient:${patient.id}`, user.clinic);

  return created(row);
}
