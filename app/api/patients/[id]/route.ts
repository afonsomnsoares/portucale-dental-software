import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { normalizeCustomFields } from '@/lib/customFields';
import { query, queryOne, warnSchemaGap } from '@/lib/db';
import { badRequest, notFound, ok } from '@/lib/http';
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

// GET /api/patients/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;
  const p = await queryOne(
    `SELECT p.*,
            ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100)::int AS no_show_score,
            COALESCE(json_agg(pa.alert) FILTER (WHERE pa.alert IS NOT NULL),'[]') AS alerts
     FROM patients p LEFT JOIN patient_alerts pa ON pa.patient_id=p.id
     WHERE p.id=$1 AND ($2::uuid IS NULL OR p.tenant_id=$2::uuid) GROUP BY p.id`,
    [id, tenantId],
  );
  if (!p) return notFound('Patient not found');
  return ok(p);
}

// PUT /api/patients/[id]
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patients:update'))) return forbidden();
  const { id } = await params;
  const body = await request.json();
  const patientErrors = validatePatientBody(body);
  if (patientErrors) return badRequest(patientErrors.join('; '));
  if (body.status) {
    const allowed = ['registered', 'waiting', 'in-operatory', 'ready-dismissal', 'departed'];
    if (!allowed.includes(body.status)) return badRequest('Invalid status');
  }

  let schemaTenantId = user.tenantId || null;
  if (user.role === 'super_admin') {
    const p = await queryOne(`SELECT tenant_id FROM patients WHERE id=$1`, [id]);
    schemaTenantId = p?.tenant_id || null;
  }
  let schema: Record<string, unknown>[] | null = [];
  if (schemaTenantId) {
    schema = await safeSchemaQuery(
      `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields WHERE tenant_id=$1`,
      [schemaTenantId],
    );
  }
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
  const incoming = body.customFields && typeof body.customFields === 'object' ? body.customFields : null;
  let customJson = null;
  if (incoming) {
    const normalized = normalizeCustomFields(schema, incoming);
    if (normalized.error) return badRequest(normalized.error);
    customJson = JSON.stringify(normalized.value || {});
  }
  const commPrefsJson = body.commPrefs && typeof body.commPrefs === 'object' ? JSON.stringify(body.commPrefs) : null;

  const tenantId = user.role === 'super_admin' ? null : user.tenantId;
  const [updated] = await query(
    `UPDATE patients SET name=$1, dob=$2, phone=$3, email=$4, insurance=$5, status=COALESCE($6,status),
        custom_fields = COALESCE($8::jsonb, custom_fields),
        comm_prefs = COALESCE($10::jsonb, comm_prefs)
     WHERE id=$7 AND ($9::uuid IS NULL OR tenant_id=$9::uuid) RETURNING *`,
    [
      body.name,
      body.dob,
      body.phone,
      body.email,
      body.insurance,
      body.status || null,
      id,
      customJson,
      tenantId,
      commPrefsJson,
    ],
  );
  if (!updated) return notFound('Patient not found');
  await appendAudit(user, 'UPDATE', `Patient — ${updated.name}`, null, 'updated', user.clinic);
  return ok(updated);
}
