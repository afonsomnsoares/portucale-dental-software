import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { getDocument } from '@/lib/documents';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';

// Read-only on purpose: a generated_documents row is a frozen record of what was handed
// to a patient (see 030_admin_documents.sql). There is no PUT — reissuing means issuing a
// new document — and no DELETE, for the same reason audit_log and patient_timeline have
// none: the trail of what the clinic declared is not something staff should be able to
// quietly remove.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'documents:read'))) return forbidden();
  const { id } = await params;

  const tenantId = user.tenantId || new URL(request.url).searchParams.get('tenantId');
  if (!tenantId) return forbidden();

  const row = await getDocument(tenantId, id);
  if (!row) return notFound('Document not found');
  return Response.json(row);
}
