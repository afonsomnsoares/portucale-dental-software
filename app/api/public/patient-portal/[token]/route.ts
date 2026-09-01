import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { normalizeCustomFields } from '@/lib/customFields';
import { enterTenantContext, query, queryOne, withSystemContext } from '@/lib/db';
import { findMissingFields, type RequiredSchemaField } from '@/lib/missingData';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { saveUploadFile } from '@/lib/uploads';
import { asDate, asEmail, sanitizeString } from '@/lib/validate';

// ─── The other unauthenticated, cross-origin-ish route in this project ─────
// Same pattern as app/api/public/leads/route.ts: no session exists here, so lookups run
// under withSystemContext() until the token resolves to a real tenant, then
// enterTenantContext() takes over for everything after — auth here is the single-use,
// hash-only bearer token itself (see app/api/patient-portal-links/route.ts), not a
// cookie. Unlike public/leads this is same-origin only (the portal page this route backs
// — app/portal/[token]/page.tsx — is served by this app, not embedded in a third-party
// site), so no CORS headers are opened here.
//
// Item 4 (Gestão do Paciente): lets a patient complete "dados em falta" / "documento
// pedido" / "consentimento pendente" themselves, without a login, closing the request on
// the staff side automatically — see the review-task creation below, which is how
// "validar informação" stays a human step even though collection is self-service.

async function resolveToken(token: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await withSystemContext(() =>
    queryOne(
      `SELECT ppt.*, p.name AS patient_name, t.name AS tenant_name
       FROM patient_portal_tokens ppt
       JOIN patients p ON p.id = ppt.patient_id
       JOIN tenants t ON t.id = ppt.tenant_id
       WHERE ppt.token_hash=$1`,
      [tokenHash],
    ),
  );
  if (!row) return { error: 'Invalid link', status: 401 } as const;
  if (row.used_at) return { error: 'This link was already used', status: 410 } as const;
  if (new Date(row.expires_at) < new Date()) return { error: 'This link has expired', status: 410 } as const;
  // From here on, read/write as the token's own tenant — same handoff as
  // app/api/public/leads/route.ts once its token resolves.
  enterTenantContext({ tenantId: row.tenant_id, role: 'system' });
  return { row } as const;
}

const SYSTEM_ACTOR = (tenantName: string) => ({ name: 'Portal do Paciente', role: 'system', clinic: tenantName });

// Closes the loop on "validar informação": a patient submitting through the portal
// creates a review task for the team instead of silently updating clinical/contact
// records unsupervised. Reuses the existing 'follow_up' task type (no schema change) —
// same idiom as lib/patientTasks.ts's shared team queue (assigned_to null).
async function createReviewTask(tenantId: string, patientId: string, title: string) {
  await query(
    `INSERT INTO patient_tasks (tenant_id, patient_id, type, title, notes)
     VALUES ($1,$2,'follow_up',$3,'Submetido pelo paciente via portal — confirmar antes de considerar concluído.')`,
    [tenantId, patientId, title],
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = getClientIp(request);
  const ipLimit = rateLimit(`patient-portal-ip:${ip}`, { limit: 30, windowMs: 60 * 1000 });
  if (!ipLimit.ok) return Response.json({ error: 'Too many requests' }, { status: 429 });

  const resolved = await resolveToken(token);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  const { row } = resolved;

  if (row.purpose === 'missing_data') {
    const patient = await queryOne(`SELECT phone, email, dob, custom_fields FROM patients WHERE id=$1`, [
      row.patient_id,
    ]);
    const schemaFields = await query(
      `SELECT field_name, label, field_type, required, rollout, enum_values
       FROM schema_fields WHERE tenant_id=$1 OR tenant_id IS NULL`,
      [row.tenant_id],
    );
    const requiredFieldsRaw = schemaFields.filter((f) => f.required && Number(f.rollout || 0) === 100);
    const requiredFields: RequiredSchemaField[] = requiredFieldsRaw.map((f) => ({
      field_name: String(f.field_name),
      label: f.label ? String(f.label) : null,
      required: true,
      rollout: Number(f.rollout),
    }));
    const missingFields = findMissingFields(
      {
        phone: patient?.phone || null,
        email: patient?.email || null,
        dob: patient?.dob || null,
        custom_fields: patient?.custom_fields || null,
      },
      requiredFields,
    );
    return Response.json({
      purpose: row.purpose,
      patientName: row.patient_name,
      tenantName: row.tenant_name,
      missingFields,
      fields: requiredFieldsRaw.map((f) => ({
        fieldName: f.field_name,
        label: f.label || f.field_name,
        fieldType: f.field_type,
        enumValues: f.enum_values,
      })),
    });
  }

  if (row.purpose === 'document_upload') {
    const task = row.task_id
      ? await queryOne(`SELECT title, notes FROM patient_tasks WHERE id=$1`, [row.task_id])
      : null;
    return Response.json({ purpose: row.purpose, patientName: row.patient_name, tenantName: row.tenant_name, task });
  }

  // consent_form
  const consentForm = row.consent_form_id
    ? await queryOne(`SELECT procedure_name, description FROM consent_forms WHERE id=$1`, [row.consent_form_id])
    : null;
  return Response.json({
    purpose: row.purpose,
    patientName: row.patient_name,
    tenantName: row.tenant_name,
    consentForm,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = getClientIp(request);
  const tokenLimit = rateLimit(`patient-portal-token:${token}`, { limit: 10, windowMs: 60 * 1000 });
  if (!tokenLimit.ok) return Response.json({ error: 'Too many requests' }, { status: 429 });
  const ipLimit = rateLimit(`patient-portal-ip:${ip}`, { limit: 30, windowMs: 60 * 1000 });
  if (!ipLimit.ok) return Response.json({ error: 'Too many requests' }, { status: 429 });

  const resolved = await resolveToken(token);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  const { row } = resolved;
  const actor = SYSTEM_ACTOR(row.tenant_name);

  if (row.purpose === 'missing_data') {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const phone = body.phone !== undefined ? sanitizeString(body.phone, 30) : null;
    const email = body.email !== undefined ? asEmail(body.email) : null;
    if (body.email !== undefined && body.email && !email) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }
    const dob = body.dob !== undefined ? asDate(body.dob) : null;
    if (body.dob !== undefined && body.dob && !dob) {
      return Response.json({ error: 'Invalid dob format (use YYYY-MM-DD)' }, { status: 400 });
    }

    let customJson: string | null = null;
    if (body.customFields && typeof body.customFields === 'object') {
      const schemaFields = await query(
        `SELECT field_name, field_type, required, rollout, enum_values
         FROM schema_fields WHERE tenant_id=$1 OR tenant_id IS NULL`,
        [row.tenant_id],
      );
      const normalized = normalizeCustomFields(schemaFields, body.customFields);
      if (normalized.error) return Response.json({ error: normalized.error }, { status: 400 });
      customJson = JSON.stringify(normalized.value || {});
    }

    await query(
      `UPDATE patients
       SET phone=COALESCE($1,phone), email=COALESCE($2,email), dob=COALESCE($3,dob),
           custom_fields = custom_fields || COALESCE($4::jsonb,'{}'::jsonb)
       WHERE id=$5`,
      [phone || null, email, dob, customJson, row.patient_id],
    );
    await query(`UPDATE patient_portal_tokens SET used_at=NOW() WHERE id=$1`, [row.id]);
    await appendTimeline(row.patient_id, actor, 'admin', 'Paciente atualizou os seus dados através do portal');
    await createReviewTask(row.tenant_id, row.patient_id, 'Rever dados submetidos pelo paciente via portal');
    await appendAudit(
      actor,
      'UPDATE',
      `Patient portal — dados: ${row.patient_name}`,
      null,
      'submitted',
      row.tenant_name,
    );
    return Response.json({ ok: true });
  }

  if (row.purpose === 'document_upload') {
    const form = await request.formData();
    const file = form.get('file') as File;
    const categoryRaw = form.get('category') ? String(form.get('category')) : null;
    const saved = await saveUploadFile({
      tenantId: row.tenant_id,
      patientId: row.patient_id,
      taskId: row.task_id || null,
      categoryRaw,
      file,
    });
    if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });

    await query(`UPDATE patient_portal_tokens SET used_at=NOW() WHERE id=$1`, [row.id]);
    await appendTimeline(row.patient_id, actor, 'admin', 'Paciente enviou um documento através do portal');
    await createReviewTask(row.tenant_id, row.patient_id, 'Rever documento submetido pelo paciente via portal');
    await appendAudit(
      actor,
      'CREATE',
      `Patient portal — documento: ${row.patient_name}`,
      null,
      'submitted',
      row.tenant_name,
    );
    return Response.json({ ok: true, uploadId: saved.row.id });
  }

  // consent_form
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const signedBy = sanitizeString(body.signedBy, 200);
  if (!signedBy) return Response.json({ error: 'signedBy is required' }, { status: 400 });

  const [updated] = await query(
    `UPDATE consent_forms SET signed_by=$1 WHERE id=$2 AND tenant_id=$3 AND (signed_by IS NULL OR signed_by='') RETURNING id`,
    [signedBy, row.consent_form_id, row.tenant_id],
  );
  if (!updated) return Response.json({ error: 'This consent form was already signed' }, { status: 409 });

  await query(`UPDATE patient_portal_tokens SET used_at=NOW() WHERE id=$1`, [row.id]);
  await appendTimeline(row.patient_id, actor, 'admin', `Consentimento assinado através do portal por ${signedBy}`);
  await createReviewTask(row.tenant_id, row.patient_id, 'Confirmar consentimento assinado via portal');
  await appendAudit(
    actor,
    'UPDATE',
    `Patient portal — consentimento: ${row.patient_name}`,
    null,
    'signed',
    row.tenant_name,
  );
  return Response.json({ ok: true });
}
