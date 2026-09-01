import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { badRequest, created } from '@/lib/http';
import { createTask, listTasks } from '@/lib/patientTasks';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asDate, asEnum, sanitizeString } from '@/lib/validate';

const TASK_TYPES = ['generic', 'call', 'document_request', 'follow_up', 'data_missing'] as const;

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patient-tasks:read'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  const assignedTo = searchParams.get('assignedTo');
  // Default to only open work — callers that want history pass status=done/cancelled explicitly.
  const status = searchParams.get('status') ?? 'pending';

  const rows = await listTasks(user.tenantId, {
    patientId,
    assignedTo,
    status: status === 'all' ? null : status,
  });
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patient-tasks:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  const title = sanitizeString(body.title, 200);
  if (!title) return badRequest('title is required');

  const type = body.type ? asEnum(body.type, TASK_TYPES) : 'generic';
  if (body.type && !type) return badRequest(`type must be one of: ${TASK_TYPES.join(', ')}`);

  if (body.dueAt && !asDate(body.dueAt) && Number.isNaN(Date.parse(body.dueAt))) {
    return badRequest('Invalid dueAt');
  }

  let patientId: string | null = null;
  if (body.patientId) {
    const patient = await getOwnedPatient(body.patientId, user);
    if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
    patientId = patient.id;
  }

  const row = await createTask(user.tenantId, user.id, {
    patientId,
    type: type || 'generic',
    title,
    notes: sanitizeString(body.notes, 2000),
    dueAt: body.dueAt || null,
    assignedTo: body.assignedTo || null,
  });

  if (patientId) {
    await appendTimeline(patientId, user, 'admin', `Tarefa criada: ${title}`);
  }
  await appendAudit(
    user,
    'CREATE',
    `Patient task: ${title}`,
    null,
    patientId ? `patient:${patientId}` : null,
    user.clinic,
  );

  return created(row);
}
