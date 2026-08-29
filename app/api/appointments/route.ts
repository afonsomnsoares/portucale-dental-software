import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asDate, requireFields, validateAppointmentBody } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const from = asDate(searchParams.get('from'));
  const to = asDate(searchParams.get('to'));
  const limitRaw = Number(searchParams.get('limit') || 500);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 500;

  const baseSql = `
    SELECT a.*, p.name as patient_name, d.name as dentist_name,
           ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100) as risk_score
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN users d ON d.id = a.dentist_id
  `;

  let rows = [];
  if (from || to) {
    const today = new Date().toISOString().slice(0, 10);
    const f = from || to || today;
    const t = to || from || today;
    rows = await query(
      `${baseSql}
       WHERE a.appt_date BETWEEN $1::date AND $2::date
         AND a.tenant_id = $3
       ORDER BY a.appt_date, a.start_time, a.chair
       LIMIT $4`,
      [f, t, user.tenantId, limit],
    );
  } else {
    const d = dateParam && asDate(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);
    rows = await query(
      `${baseSql}
       WHERE a.appt_date = $1::date AND a.tenant_id = $2
       ORDER BY a.start_time, a.chair
       LIMIT $3`,
      [d, user.tenantId, limit],
    );
  }
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'appointments:create'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const body = await request.json();
  const missing = requireFields(body, ['patientId', 'dentistId', 'date', 'startTime', 'type']);
  if (missing.length)
    return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
  const validationErrors = validateAppointmentBody(body);
  if (validationErrors) return Response.json({ error: validationErrors.join('; ') }, { status: 400 });

  if (!(await getOwnedPatient(body.patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const dentist = await queryOne(
    `SELECT id, name FROM users WHERE id=$1 AND role='dentist' AND active=TRUE AND tenant_id=$2`,
    [body.dentistId, user.tenantId],
  );
  if (!dentist) return Response.json({ error: 'Invalid dentist' }, { status: 400 });

  const chair = Math.max(1, Math.min(99, Number(body.chair) || 1));
  const duration = Math.max(5, Math.min(480, Number(body.duration) || 30));

  const [apt] = await query(
    `INSERT INTO appointments (tenant_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8,$9,'confirmed',$10)
     RETURNING *`,
    [
      user.tenantId,
      body.patientId,
      String(body.patientName || '').slice(0, 200),
      dentist.id,
      chair,
      body.date,
      body.startTime,
      duration,
      String(body.type).slice(0, 100),
      String(body.notes || '').slice(0, 2000) || null,
    ],
  );
  await appendAudit(
    user,
    'CREATE',
    `Appointment for ${body.patientName} — ${body.type}`,
    null,
    'confirmed',
    user.clinic,
  );
  await appendTimeline(
    body.patientId,
    user,
    'admin',
    `Consulta marcada: ${body.type} em ${body.date} (Dentista: ${dentist.name})`,
  );
  return Response.json(apt, { status: 201 });
}
