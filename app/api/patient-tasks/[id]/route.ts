import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { badRequest, notFound } from '@/lib/http';
import { getTask, updateTask } from '@/lib/patientTasks';
import { withRoute } from '@/lib/route';
import { getOwnedUser } from '@/lib/tenantGuard';
import { asEnum, sanitizeString } from '@/lib/validate';

const TASK_STATUSES = ['pending', 'done', 'cancelled'] as const;

export const PUT = withRoute<{ id: string }>(
  { permission: 'patient-tasks:update', tenant: 'optional' },
  async ({ request, user, params }) => {
    if (!user.tenantId) return forbidden();
    const { id } = params;

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

    // Reatribuição: o id vem do cliente, por isso confirma-se que é alguém desta
    // clínica antes de o gravar (ver getOwnedUser). `null` é válido — devolve a
    // tarefa à fila partilhada.
    let assignedTo: string | null | undefined;
    if (body.assignedTo !== undefined) {
      if (body.assignedTo === null || body.assignedTo === '') {
        assignedTo = null;
      } else {
        const assignee = await getOwnedUser(body.assignedTo, user);
        if (!assignee) return badRequest('assignedTo is not a user in this clinic');
        assignedTo = assignee.id;
      }
    }

    const row = await updateTask(user.tenantId, id, {
      title: body.title !== undefined ? sanitizeString(body.title, 200) || prev.title : undefined,
      notes: body.notes !== undefined ? sanitizeString(body.notes, 2000) : undefined,
      dueAt: body.dueAt !== undefined ? body.dueAt : undefined,
      assignedTo,
      // Botão "Atribuir automaticamente" na fila de tarefas — deixa o router
      // escolher em vez de obrigar a rececionista a saber quem está de turno.
      autoAssign: body.autoAssign === true,
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
  },
);
