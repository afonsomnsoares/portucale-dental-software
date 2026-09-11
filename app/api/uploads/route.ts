import { queryRead } from '@/lib/db';
import { badRequest } from '@/lib/http';
import { getTask } from '@/lib/patientTasks';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { saveUploadFile } from '@/lib/uploads';

// GET /api/uploads?patientId= — documents panel (Fase C): lists what's already on
// file for a patient, grouped by category in the UI.
export const GET = withRoute({ permission: 'uploads:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  if (!patientId) return badRequest('patientId is required');
  if (!(await getOwnedPatient(patientId, { tenantId }))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const rows = await queryRead(`SELECT * FROM uploads WHERE tenant_id=$1 AND patient_id=$2 ORDER BY created_at DESC`, [
    tenantId,
    patientId,
  ]);
  return Response.json(rows);
});

export const POST = withRoute({ permission: 'uploads:create' }, async ({ request, tenantId }) => {
  const form = await request.formData();
  const file = form.get('file') as File;
  const patientId = form.get('patientId') ? String(form.get('patientId')) : null;
  const taskId = form.get('taskId') ? String(form.get('taskId')) : null;
  const categoryRaw = form.get('category') ? String(form.get('category')) : null;
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Missing file' }, { status: 400 });
  }
  if (patientId && !(await getOwnedPatient(patientId, { tenantId }))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }
  // A taskId must be a pending document_request task on the SAME patient this upload is
  // for — otherwise a caller could close an arbitrary tenant task by guessing/reusing an id.
  if (taskId) {
    const task = await getTask(tenantId, taskId);
    if (task?.type !== 'document_request' || task.patient_id !== patientId) {
      return Response.json({ error: 'Invalid taskId' }, { status: 400 });
    }
  }

  const saved = await saveUploadFile({ tenantId, patientId, taskId, categoryRaw, file });
  if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });

  return Response.json(
    {
      url: saved.row.url,
      name: String(file.name || 'upload'),
      size: saved.row.size,
      type: saved.row.content_type,
      uploadId: saved.row.id,
      category: saved.row.category,
    },
    { status: 201 },
  );
});
