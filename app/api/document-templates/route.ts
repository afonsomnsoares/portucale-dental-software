import { appendAudit } from '@/lib/audit';
import { createTemplate, listTemplates, seedPresetTemplates, unknownPlaceholders } from '@/lib/documents';
import { DOCUMENT_TEMPLATE_TYPES, DOCUMENT_VARIABLES } from '@/lib/documentsCalc';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, sanitizeString } from '@/lib/validate';

// GET needs only 'documents:read' (not ':manage') for the same reason the checklist
// templates list is open to any member: you need to see the models to issue a document
// from one. Writing a template is the privileged half.
export const GET = withRoute({ permission: 'documents:read', tenant: 'resolved' }, async ({ request, tenantId }) => {
  const includeInactive = new URL(request.url).searchParams.get('active') === 'false';
  const rows = await listTemplates(tenantId, includeInactive);
  // The variable catalogue travels with the list so the template editor can show what
  // it's allowed to reference without a second round trip or a duplicated client copy.
  return Response.json({ templates: rows, variables: DOCUMENT_VARIABLES });
});

export const POST = withRoute(
  { permission: 'document-templates:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');

    // One-click "Adicionar modelos PT" — same shape as POST /api/schema's preset bundle.
    if (body.preset === true) {
      const result = await seedPresetTemplates(tenantId, user.id);
      await appendAudit(
        user,
        'CREATE',
        'Document templates: PT preset',
        null,
        `${result.created} created`,
        user.clinic,
      );
      return created(result);
    }

    const name = sanitizeString(body.name, 200);
    if (!name) return badRequest('name is required');
    const type = body.type ? asEnum(body.type, DOCUMENT_TEMPLATE_TYPES) : 'declaration';
    if (body.type && !type) return badRequest(`type must be one of: ${DOCUMENT_TEMPLATE_TYPES.join(', ')}`);

    const templateBody = sanitizeString(body.body, 20000);
    if (!templateBody) return badRequest('body is required');

    // Rejected, not silently accepted: a marker nothing can fill would print as a blank
    // line in a document handed to a patient. Better to fail here, in the editor.
    const unknown = unknownPlaceholders(`${templateBody} ${sanitizeString(body.subject, 300)}`);
    if (unknown.length) return badRequest(`Unknown placeholders: ${unknown.join(', ')}`);

    const row = await createTemplate(tenantId, user.id, {
      name,
      type: (type || 'declaration') as (typeof DOCUMENT_TEMPLATE_TYPES)[number],
      subject: sanitizeString(body.subject, 300) || name,
      body: templateBody,
    });

    await appendAudit(user, 'CREATE', `Document template: ${name}`, null, type, user.clinic);
    return created(row);
  },
);
