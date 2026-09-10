import { appendAudit } from '@/lib/audit';
import { deactivateTemplate, getTemplate, unknownPlaceholders, updateTemplate } from '@/lib/documents';
import { DOCUMENT_TEMPLATE_TYPES } from '@/lib/documentsCalc';
import { badRequest, notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, sanitizeString } from '@/lib/validate';

export const PUT = withRoute<{ id: string }>(
  { permission: 'document-templates:manage', tenant: 'resolved' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;

    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');

    const prev = await getTemplate(tenantId, id);
    if (!prev) return notFound('Template not found');

    let type: string | null | undefined;
    if (body.type !== undefined) {
      type = asEnum(body.type, DOCUMENT_TEMPLATE_TYPES);
      if (!type) return badRequest(`type must be one of: ${DOCUMENT_TEMPLATE_TYPES.join(', ')}`);
    }

    const nextBody = body.body !== undefined ? sanitizeString(body.body, 20000) : undefined;
    const nextSubject = body.subject !== undefined ? sanitizeString(body.subject, 300) : undefined;
    // Same check as POST — re-validated here because an edit can introduce a bad marker
    // just as easily as a create can.
    const unknown = unknownPlaceholders(`${nextBody ?? prev.body} ${nextSubject ?? prev.subject}`);
    if (unknown.length) return badRequest(`Unknown placeholders: ${unknown.join(', ')}`);

    const row = await updateTemplate(tenantId, id, {
      name: body.name !== undefined ? sanitizeString(body.name, 200) || prev.name : undefined,
      type: (type as (typeof DOCUMENT_TEMPLATE_TYPES)[number]) ?? undefined,
      subject: nextSubject,
      body: nextBody,
      active: body.active !== undefined ? !!body.active : undefined,
    });
    if (!row) return notFound('Template not found');

    await appendAudit(user, 'UPDATE', `Document template: ${prev.name}`, prev.type, row.type, user.clinic);
    return Response.json(row);
  },
);

// Deactivates rather than deletes — see deactivateTemplate in lib/documents.ts for why
// (already-issued documents keep pointing at the model they came from).
export const DELETE = withRoute<{ id: string }>(
  { permission: 'document-templates:manage', tenant: 'resolved' },
  async ({ user, params, tenantId }) => {
    const { id } = params;

    const row = await deactivateTemplate(tenantId, id);
    if (!row) return notFound('Template not found');

    await appendAudit(user, 'UPDATE', `Document template: ${row.name}`, 'active', 'inactive', user.clinic);
    return Response.json({ ok: true, id: row.id });
  },
);
