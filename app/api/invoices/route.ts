import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { asDate, asFee, asString, requireFields } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'invoices:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId') || user.tenantId;
  if (!tenantId) return forbidden();

  const status = searchParams.get('status');
  const patientId = searchParams.get('patientId');
  const from = asDate(searchParams.get('from'));
  const to = asDate(searchParams.get('to'));
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get('limit') || 200)));

  let sql = `
    SELECT i.*, d.name as dentist_name
    FROM invoices i
    LEFT JOIN users d ON d.id = i.dentist_id
    WHERE i.tenant_id = $1
  `;
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (status) {
    sql += ` AND i.status = $${idx++}`;
    params.push(status);
  }
  if (patientId) {
    sql += ` AND i.patient_id = $${idx++}`;
    params.push(patientId);
  }
  if (from) {
    sql += ` AND i.invoice_date >= $${idx++}::date`;
    params.push(from);
  }
  if (to) {
    sql += ` AND i.invoice_date <= $${idx++}::date`;
    params.push(to);
  }

  sql += ` ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT $${idx}`;
  params.push(limit);

  const rows = await query(sql, params);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'invoices:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  const missing = requireFields(body, ['patientId', 'amount']);
  if (missing.length)
    return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });

  const patient = await queryOne(`SELECT id, name, tenant_id FROM patients WHERE id=$1`, [body.patientId]);
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  if (patient.tenant_id !== user.tenantId) return forbidden();

  const amount = asFee(body.amount);
  if (amount === null) return Response.json({ error: 'Invalid amount' }, { status: 400 });

  let dentistId = body.dentistId || null;
  if (dentistId) {
    const dentist = await queryOne(`SELECT id FROM users WHERE id=$1 AND role='dentist'`, [dentistId]);
    if (!dentist) dentistId = null;
  }

  const items = Array.isArray(body.items) ? JSON.stringify(body.items) : '[]';
  const notes = asString(body.notes, { max: 2000 });
  const invoiceDate = asDate(body.invoiceDate) || new Date().toISOString().slice(0, 10);
  const dueDate = asDate(body.dueDate) || null;

  const [inv] = await query(
    `INSERT INTO invoices (tenant_id, patient_id, patient_name, dentist_id, amount, items, notes, invoice_date, due_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::date,$9::date,'pending',$10)
     RETURNING *`,
    [user.tenantId, patient.id, patient.name, dentistId, amount, items, notes, invoiceDate, dueDate, user.id],
  );

  await appendAudit(
    user,
    'CREATE',
    `Invoice ${formatId(inv.id)} — $${amount} for ${patient.name}`,
    null,
    'pending',
    user.clinic,
  );
  await appendTimeline(patient.id, user, 'financial', `Fatura ${formatId(inv.id)} criada — €${amount}`);

  return Response.json(inv, { status: 201 });
}

function formatId(uuid: string) {
  return uuid ? uuid.slice(0, 8).toUpperCase() : '—';
}
