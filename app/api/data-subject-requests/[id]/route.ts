import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, sanitizeString } from '@/lib/validate';

const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'] as const;

export const GET = withRoute<{ id: string }>(
  { permission: 'gdpr:read', tenant: 'optional' },
  async ({ user, params }) => {
    if (!user.tenantId) return forbidden();
    const { id } = params;

    const row = await queryOne(
      `SELECT r.*, p.name AS patient_name FROM data_subject_requests r
     LEFT JOIN patients p ON p.id = r.patient_id
     WHERE r.id=$1 AND r.tenant_id=$2`,
      [id, user.tenantId],
    );
    if (!row) return notFound('Request not found');
    return Response.json(row);
  },
);

export const PUT = withRoute<{ id: string }>(
  { permission: 'gdpr:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    if (!user.tenantId) return forbidden();
    const { id } = params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return badRequest('Invalid request body');

    const prev = await queryOne(`SELECT * FROM data_subject_requests WHERE id=$1 AND tenant_id=$2`, [
      id,
      user.tenantId,
    ]);
    if (!prev) return notFound('Request not found');

    let status = prev.status;
    if (body.status !== undefined) {
      const valid = asEnum(body.status, STATUSES);
      if (!valid) return badRequest(`status must be one of: ${STATUSES.join(', ')}`);
      status = valid;
    }

    // 'completed' só se atinge por [id]/fulfil, que é onde o trabalho acontece de
    // facto. Deixar marcar aqui à mão seria deixar registar "cumprido" sem nada
    // ter sido cumprido — e é exatamente esse registo que a clínica mostraria a
    // uma autoridade de controlo.
    if (status === 'completed' && prev.status !== 'completed') {
      return badRequest('Use POST /api/data-subject-requests/{id}/fulfil to complete a request');
    }

    const [row] = await query(
      `UPDATE data_subject_requests
     SET status=$1, notes=$2, updated_at=NOW(),
         resolved_at = CASE WHEN $1 = 'rejected' THEN NOW() ELSE resolved_at END,
         resolved_by = CASE WHEN $1 = 'rejected' THEN $3::uuid ELSE resolved_by END
     WHERE id=$4 AND tenant_id=$5
     RETURNING *`,
      [status, body.notes !== undefined ? sanitizeString(body.notes, 2000) : prev.notes, user.id, id, user.tenantId],
    );

    await appendAudit(user, 'UPDATE', `RGPD request ${prev.request_type}`, prev.status, status, user.clinic);
    return Response.json(row);
  },
);
