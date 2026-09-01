import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { normalizeCustomFields } from '@/lib/customFields';
import { query, warnSchemaGap } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { validatePatientBody } from '@/lib/validate';

async function safeSchemaQuery(sql: string, params: unknown[] = []) {
  try {
    return await query(sql, params);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42703' || code === '42P01') {
      warnSchemaGap('patients.custom_fields', e);
      return null;
    }
    throw e;
  }
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('q') || '';
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;
  const rows = await query(
    `SELECT p.*,
            ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100)::int AS no_show_score,
            COALESCE(json_agg(pa.alert) FILTER (WHERE pa.alert IS NOT NULL), '[]') AS alerts
     FROM patients p
     LEFT JOIN patient_alerts pa ON pa.patient_id = p.id
     WHERE ($1 = '' OR p.name ILIKE $2 OR p.global_seq::text ILIKE $2)
       AND ($3::uuid IS NULL OR p.tenant_id = $3::uuid)
     GROUP BY p.id
     ORDER BY p.name`,
    [search, `%${search}%`, tenantId],
  );
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patients:create'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const body = await request.json();
  const patientErrors = validatePatientBody(body);
  if (patientErrors) return badRequest(patientErrors.join('; '));

  let schema = await safeSchemaQuery(
    `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields WHERE tenant_id=$1`,
    [user.tenantId],
  );
  if (schema === null) {
    schema = await query(`SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields`);
  } else if (!schema.length) {
    const global = await safeSchemaQuery(
      `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields WHERE tenant_id IS NULL`,
    );
    schema =
      global === null
        ? await query(`SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields`)
        : global;
  }
  const normalized = normalizeCustomFields(schema, body.customFields);
  if (normalized.error) return badRequest(normalized.error);

  const [patient] = await query(
    `INSERT INTO patients (tenant_id, name, dob, phone, email, insurance, balance, status, custom_fields)
     VALUES ($1,$2,$3,$4,$5,$6,0,'registered',$7::jsonb) RETURNING *`,
    [
      user.tenantId,
      body.name,
      body.dob,
      body.phone,
      body.email,
      body.insurance,
      JSON.stringify(normalized.value || {}),
    ],
  );
  if (body.alerts?.length) {
    for (const alert of body.alerts) {
      await query(`INSERT INTO patient_alerts (patient_id, alert) VALUES ($1,$2)`, [patient.id, alert]);
    }
  }
  await appendTimeline(
    patient.id,
    user,
    'admin',
    `Perfil de paciente criado — ID Global #${patient.global_seq} atribuído`,
  );
  await appendAudit(user, 'CREATE', `Patient — ${patient.name}`, null, 'registered', user.clinic);
  return created(patient);
}
