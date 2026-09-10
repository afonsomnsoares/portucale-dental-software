import { appendAudit, appendTimeline } from '@/lib/audit';
import { unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asInt, sanitizeString } from '@/lib/validate';

export const GET = withRoute({ permission: 'recalls:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  const dueBefore = searchParams.get('dueBefore');

  let sql = `SELECT r.*, p.name AS patient_name
             FROM recalls r
             JOIN patients p ON p.id = r.patient_id
             WHERE 1=1`;
  const vals = [];
  if (patientId) {
    vals.push(patientId);
    sql += ` AND r.patient_id=$${vals.length}`;
  }
  if (dueBefore) {
    vals.push(dueBefore);
    sql += ` AND r.active=TRUE AND r.next_due <= $${vals.length}::date`;
  }
  if (user.tenantId) {
    vals.push(user.tenantId);
    sql += ` AND r.tenant_id=$${vals.length}`;
  }
  sql += ' ORDER BY r.next_due';

  const rows = await query(sql, vals);
  return Response.json(rows);
});

export const POST = withRoute({ permission: 'recalls:manage', tenant: 'optional' }, async ({ request, user }) => {
  if (!user.tenantId) return unauthorized();
  const body = await request.json();
  const { patientId, recallType, intervalMonths, lastDone, nextDue, notes } = body;

  if (!patientId || !recallType) {
    return Response.json({ error: 'patientId and recallType required' }, { status: 400 });
  }
  const interval = asInt(intervalMonths ?? 6, { min: 1, max: 60 });
  if (interval === null) return Response.json({ error: 'intervalMonths must be between 1 and 60' }, { status: 400 });

  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const [row] = await query(
    `INSERT INTO recalls
       (tenant_id, patient_id, recall_type, interval_months, last_done, next_due, notes, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
     RETURNING *`,
    [
      user.tenantId,
      patientId,
      sanitizeString(recallType, 100),
      interval,
      lastDone || null,
      nextDue || null,
      sanitizeString(notes, 2000),
      user.id,
    ],
  );

  await appendTimeline(patientId, user, 'admin', `Recall definido: ${recallType} a cada ${intervalMonths || 6} meses`);
  await appendAudit(user, 'CREATE', `Recall: ${recallType}`, null, `patient:${patientId}`, user.clinic);

  return Response.json(row, { status: 201 });
});
