import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { badRequest, notFound } from '@/lib/http';
import { getTask, updateTask } from '@/lib/patientTasks';
import { hasPermission } from '@/lib/permissions';
import { asEnum, sanitizeString } from '@/lib/validate';

const TASK_STATUSES = ['pending', 'done', 'cancelled'] as const;

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patient-tasks:update'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const { id } = await params;

  const prev = await getTask(user.tenantId, id);
  if (!prev) return notFound('Task not found');

  const body = await request.json();
  let status: 'pending' | 'done' | 'cancelled' | undefined;
  if (body.status !== undefined) {
    status = asEnum(body.status, TASK_STATUSES) as typeof status;
    if (!status) return badRequest(`status must be one of: ${TASK_STATUSES.join(', ')}`);
  }
  // Shorthand booleans used by the UI ("Concluir"/"Cancelar" buttons) so callers don't
  // need to know the status string — same convention as recalls' `complete: true`.
  if (body.complete === true) status = 'done';
  if (body.cancel === true) status = 'cancelled';

  const row = await updateTask(user.tenantId, id, {
    title: body.title !== undefined ? sanitizeString(body.title, 200) || prev.title : undefined,
    notes: body.notes !== undefined ? sanitizeString(body.notes, 2000) : undefined,
    dueAt: body.dueAt !== undefined ? body.dueAt : undefined,
    assignedTo: body.assignedTo !== undefined ? body.assignedTo : undefined,
    status,
  });
  if (!row) return notFound('Task not found');

  if (status === 'done' && prev.patient_id) {
    await appendTimeline(prev.patient_id, user, 'admin', `Tarefa concluída: ${prev.title}`);
  }
  await appendAudit(
    user,
    'UPDATE',
    `Patient task: ${prev.title}`,
    `status:${prev.status}`,
    `status:${row.status}`,
    user.clinic,
  );

  return Response.json(row);
}
