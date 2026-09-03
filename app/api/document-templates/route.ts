import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { createTemplate, listTemplates, seedPresetTemplates, unknownPlaceholders } from '@/lib/documents';
import { DOCUMENT_TEMPLATE_TYPES, DOCUMENT_VARIABLES } from '@/lib/documentsCalc';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asEnum, sanitizeString } from '@/lib/validate';

// Same convention as app/api/checklist-templates/route.ts: a tenant-scoped user always
// acts on their own tenant; a super_admin (no tenantId of their own) must say which one
// via ?tenantId=/body.tenantId.
function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

// GET needs only 'documents:read' (not ':manage') for the same reason the checklist
// templates list is open to any member: you need to see the models to issue a document
// from one. Writing a template is the privileged half.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'documents:read'))) return forbidden();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const includeInactive = new URL(request.url).searchParams.get('active') === 'false';
  const rows = await listTemplates(tenantId, includeInactive);
  // The variable catalogue travels with the list so the template editor can show what
  // it's allowed to reference without a second round trip or a duplicated client copy.
  return Response.json({ templates: rows, variables: DOCUMENT_VARIABLES });
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'document-templates:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');

  // One-click "Adicionar modelos PT" — same shape as POST /api/schema's preset bundle.
  if (body.preset === true) {
    const result = await seedPresetTemplates(tenantId, user.id);
    await appendAudit(user, 'CREATE', 'Document templates: PT preset', null, `${result.created} created`, user.clinic);
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
}
