import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne, withTransaction } from '@/lib/db';
import { conflict } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient, getOwnedUser } from '@/lib/tenantGuard';
import { asDate, requireFields, validateAppointmentBody } from '@/lib/validate';

// Internal-only signal from the transaction below to the catch block — never
// serialized or exposed, just a way to distinguish "slot taken" from any
// other failure without stringly-typed error matching.
class SlotTakenError extends Error {}

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
  // Um paciente concreto, sem janela de datas — é o que a emissão de documentos
  // administrativos precisa (escolher a consulta que a declaração refere, ver
  // app/api/documents/route.ts). Ordenado do mais recente para o mais antigo,
  // que é a ordem em que se procura "a consulta de que estamos a falar".
  const patientId = searchParams.get('patientId');
  if (patientId) {
    rows = await query(
      `${baseSql}
       WHERE a.patient_id = $1 AND a.tenant_id = $2
       ORDER BY a.appt_date DESC, a.start_time DESC
       LIMIT $3`,
      [patientId, user.tenantId, limit],
    );
  } else if (from || to) {
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

  const dentist = await getOwnedUser(body.dentistId, user, { role: 'dentist', activeOnly: true });
  if (!dentist) return Response.json({ error: 'Invalid dentist' }, { status: 400 });

  const chair = Math.max(1, Math.min(99, Number(body.chair) || 1));
  const duration = Math.max(5, Math.min(480, Number(body.duration) || 30));

  // Neither this route nor a schema constraint used to stop two overlapping
  // appointments from being created for the same dentist or the same chair —
  // the client-side auto-chair-pick (and now the /suggest endpoint) only ever
  // avoided *offering* a clash, they never prevented one at the moment of
  // insert. An advisory lock keyed by tenant+dentist+day serializes concurrent
  // bookings for that dentist (mirrors the pg_advisory_xact_lock pattern used
  // by the audit_log hash-chain trigger, migrations/015), and the conflict
  // check re-runs inside the same transaction so two requests racing each
  // other can't both pass it.
  let apt: Record<string, unknown>;
  try {
    apt = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${user.tenantId}|${dentist.id}|${body.date}`]);

      const { rows: clashes } = await client.query(
        `SELECT id FROM appointments
         WHERE tenant_id=$1 AND appt_date=$2::date
           AND (dentist_id=$3 OR chair=$4)
           AND start_time < ($5::time + make_interval(mins => $6::int))
           AND (start_time + make_interval(mins => duration)) > $5::time
         LIMIT 1`,
        [user.tenantId, body.date, dentist.id, chair, body.startTime, duration],
      );
      if (clashes.length) {
        throw new SlotTakenError();
      }

      const { rows } = await client.query(
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
      return rows[0];
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return conflict('Este horário deixou de estar disponível — escolha outro.');
    }
    throw e;
  }
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
