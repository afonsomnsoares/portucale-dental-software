import { appendAudit, appendTimeline } from '@/lib/audit';
import { badRequest, created } from '@/lib/http';
import { createTask, listTasks } from '@/lib/patientTasks';
import { withRoute } from '@/lib/route';
import { getOwnedPatient, getOwnedUser } from '@/lib/tenantGuard';
import { asDate, asEnum, sanitizeString } from '@/lib/validate';

const TASK_TYPES = ['generic', 'call', 'document_request', 'follow_up', 'data_missing'] as const;

export const GET = withRoute({ permission: 'patient-tasks:read' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  const assignedTo = searchParams.get('assignedTo');
  // Default to only open work — callers that want history pass status=done/cancelled explicitly.
  const status = searchParams.get('status') ?? 'pending';

  const rows = await listTasks(tenantId, {
    patientId,
    assignedTo,
    status: status === 'all' ? null : status,
  });
  return Response.json(rows);
});

export const POST = withRoute({ permission: 'patient-tasks:create' }, async ({ request, user, tenantId }) => {
  const body = await request.json();
  const title = sanitizeString(body.title, 200);
  if (!title) return badRequest('title is required');

  const type = body.type ? asEnum(body.type, TASK_TYPES) : 'generic';
  if (body.type && !type) return badRequest(`type must be one of: ${TASK_TYPES.join(', ')}`);

  if (body.dueAt && !asDate(body.dueAt) && Number.isNaN(Date.parse(body.dueAt))) {
    return badRequest('Invalid dueAt');
  }

  // Um assignedTo explícito é um id de utilizador vindo do cliente — a FK só
  // garante que existe, não que é desta clínica (ver getOwnedUser).
  let assignedTo: string | null = null;
  if (body.assignedTo) {
    const assignee = await getOwnedUser(body.assignedTo, { tenantId });
    if (!assignee) return badRequest('assignedTo is not a user in this clinic');
    assignedTo = assignee.id;
  }

  let patientId: string | null = null;
  if (body.patientId) {
    const patient = await getOwnedPatient(body.patientId, { tenantId });
    if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
    patientId = patient.id;
  }

  const row = await createTask(tenantId, user.id, {
    patientId,
    type: type || 'generic',
    title,
    notes: sanitizeString(body.notes, 2000),
    dueAt: body.dueAt || null,
    assignedTo,
    // Opt-in: a UI oferece "atribuir automaticamente" como alternativa a escolher
    // uma pessoa, e nunca sobrepõe um assignedTo explícito (ver lib/patientTasks.ts).
    autoAssign: body.autoAssign === true,
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
});
