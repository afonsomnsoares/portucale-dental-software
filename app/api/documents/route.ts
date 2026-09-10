import { appendAudit, appendTimeline } from '@/lib/audit';
import { generateDocument, listDocuments } from '@/lib/documents';
import { DOCUMENT_VARIABLES } from '@/lib/documentsCalc';
import { apiError, badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { sanitizeString } from '@/lib/validate';

const VARIABLE_KEYS = new Set(DOCUMENT_VARIABLES.map((v) => v.key));

export const GET = withRoute({ permission: 'documents:read', tenant: 'resolved' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get('limit') || 100);
  const rows = await listDocuments(tenantId, {
    patientId: searchParams.get('patientId'),
    limit: Number.isFinite(limitRaw) ? limitRaw : 100,
  });
  return Response.json(rows);
});

export const POST = withRoute(
  { permission: 'documents:generate', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');

    const templateId = String(body.templateId || '');
    if (!templateId) return badRequest('templateId is required');

    // Cross-tenant guard before anything else touches the patient — same call every other
    // route that accepts a client-supplied patientId makes (see lib/tenantGuard.ts).
    const patient = await getOwnedPatient(body.patientId, user);
    if (!patient) return apiError({ status: 404, code: 'NOT_FOUND', message: 'Patient not found' });

    // Only catalogue keys survive: an override for an unknown key would silently do
    // nothing, and one for a key the template doesn't use is harmless but pointless.
    const overrides: Record<string, string> = {};
    if (body.overrides && typeof body.overrides === 'object') {
      for (const [k, v] of Object.entries(body.overrides as Record<string, unknown>)) {
        if (VARIABLE_KEYS.has(k)) overrides[k] = sanitizeString(v, 300);
      }
    }

    const result = await generateDocument(
      tenantId,
      { id: user.id, name: user.name },
      {
        templateId,
        patientId: String(patient.id),
        appointmentId: body.appointmentId ? String(body.appointmentId) : null,
        overrides,
      },
    );
    if (!result.ok) return apiError({ status: result.status, message: result.error });

    await appendTimeline(String(patient.id), user, 'admin', `Documento emitido: ${result.row.title}`);
    await appendAudit(
      user,
      'CREATE',
      `Document issued: ${result.row.template_name}`,
      null,
      `patient:${patient.id}`,
      user.clinic,
    );

    return created({ document: result.row, missing: result.missing });
  },
);
