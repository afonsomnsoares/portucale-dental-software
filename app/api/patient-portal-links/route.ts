import crypto from 'node:crypto';
import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { getTask } from '@/lib/patientTasks';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asEnum } from '@/lib/validate';

// Staff-side half of the patient portal (item 4 — "enviar formulários", "pedir
// documentos", "explicar o que levar"): mints a single-use, expiring, hash-only token a
// patient can use — with no login of their own — at GET/POST
// /api/public/patient-portal/[token] to fill in missing data, upload a requested
// document, or sign a pending consent form. Same token-issuance shape as
// app/api/lead-sources/route.ts (crypto.randomBytes, sha256 hash stored, plaintext shown
// exactly once here).
const PURPOSES = ['missing_data', 'document_upload', 'consent_form'] as const;
const DEFAULT_EXPIRY_HOURS = 72;

export const POST = withRoute(
  { permission: 'patient-portal:manage', tenant: 'optional' },
  async ({ request, user }) => {
    if (!user.tenantId) return forbidden();

    const body = await request.json();
    const patient = await getOwnedPatient(body.patientId, user);
    if (!patient) return badRequest('patientId is required and must belong to your clinic');

    const purpose = asEnum(body.purpose, PURPOSES);
    if (!purpose) return badRequest(`purpose must be one of: ${PURPOSES.join(', ')}`);

    let taskId: string | null = null;
    let consentFormId: string | null = null;

    if (purpose === 'document_upload') {
      const task = body.taskId ? await getTask(user.tenantId, String(body.taskId)) : null;
      if (task?.type !== 'document_request' || task.patient_id !== patient.id || task.status !== 'pending') {
        return badRequest('taskId must be a pending document_request task for this patient');
      }
      taskId = task.id;
    }

    if (purpose === 'consent_form') {
      const form = body.consentFormId
        ? await queryOne(`SELECT id, signed_by FROM consent_forms WHERE id=$1 AND tenant_id=$2 AND patient_id=$3`, [
            body.consentFormId,
            user.tenantId,
            patient.id,
          ])
        : null;
      if (!form) return badRequest('consentFormId must reference a consent form for this patient');
      if (form.signed_by) return badRequest('This consent form is already signed');
      consentFormId = form.id;
    }

    const expiresInHours = Math.max(1, Math.min(24 * 14, Number(body.expiresInHours) || DEFAULT_EXPIRY_HOURS));
    const token = `pt_${crypto.randomBytes(24).toString('base64url')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [row] = await query(
      `INSERT INTO patient_portal_tokens
       (tenant_id, patient_id, task_id, consent_form_id, purpose, token_hash, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7::int * INTERVAL '1 hour'), $8)
     RETURNING id, purpose, expires_at`,
      [user.tenantId, patient.id, taskId, consentFormId, purpose, tokenHash, expiresInHours, user.id],
    );

    await appendAudit(user, 'CREATE', `Patient portal link: ${purpose}`, null, `patient:${patient.id}`, user.clinic);

    // The only response, ever, that carries the plaintext token — same convention as
    // app/api/lead-sources/route.ts's POST.
    return created({ ...row, url: `/portal/${token}` });
  },
);
