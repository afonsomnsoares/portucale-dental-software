import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { withRoute } from '@/lib/route';
import { asDate, asTime } from '@/lib/validate';
import { updateWaitlistEntry } from '@/lib/waitlist';

export const PUT = withRoute<{ id: string }>(
  { permission: 'waitlist:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    if (!user.tenantId) return forbidden();

    const { id } = params;
    const body = await request.json();

    if (body.preferredTimeStart && !asTime(body.preferredTimeStart)) {
      return Response.json({ error: 'Invalid preferredTimeStart (use HH:MM)' }, { status: 400 });
    }
    if (body.preferredTimeEnd && !asTime(body.preferredTimeEnd)) {
      return Response.json({ error: 'Invalid preferredTimeEnd (use HH:MM)' }, { status: 400 });
    }
    if (body.maxWaitUntil && !asDate(body.maxWaitUntil)) {
      return Response.json({ error: 'Invalid maxWaitUntil (use YYYY-MM-DD)' }, { status: 400 });
    }
    const status = body.status;
    if (status && !['active', 'offered', 'fulfilled', 'expired', 'cancelled'].includes(status)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 });
    }

    const preferredDays = Array.isArray(body.preferredDays)
      ? body.preferredDays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
      : undefined;

    const updated = await updateWaitlistEntry(user.tenantId, id, {
      treatmentType: body.treatmentType,
      preferredDentistId: body.preferredDentistId,
      preferredDays,
      preferredTimeStart: body.preferredTimeStart,
      preferredTimeEnd: body.preferredTimeEnd,
      minDuration: body.minDuration,
      maxWaitUntil: body.maxWaitUntil,
      notes: body.notes,
      status,
    });
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

    if (status === 'cancelled') {
      await appendTimeline(updated.patient_id, user, 'admin', `Removido da lista de espera: ${updated.treatment_type}`);
    }
    await appendAudit(
      user,
      'UPDATE',
      `Waitlist: ${updated.treatment_type}`,
      null,
      `status:${updated.status}`,
      user.clinic,
    );

    return Response.json(updated);
  },
);
