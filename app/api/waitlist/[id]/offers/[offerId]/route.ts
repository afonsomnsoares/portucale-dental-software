import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { withRoute } from '@/lib/route';
import { acceptOfferAndBook, declineOffer } from '@/lib/waitlist';

export const PUT = withRoute<{ id: string; offerId: string }>(
  { permission: 'waitlist:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    if (!user.tenantId) return forbidden();

    const { offerId } = params;
    const { action } = await request.json();
    if (!['book', 'decline'].includes(action)) {
      return Response.json({ error: "action must be 'book' or 'decline'" }, { status: 400 });
    }

    if (action === 'book') {
      const result = await acceptOfferAndBook(user.tenantId, offerId);
      if (!result) return Response.json({ error: 'Offer not found or already resolved' }, { status: 404 });

      await appendTimeline(
        String(result.appointment.patient_id),
        user,
        'admin',
        `Consulta marcada a partir da lista de espera: ${String(result.appointment.appt_date).slice(0, 10)} ${String(result.appointment.start_time).slice(0, 5)}`,
      );
      await appendAudit(user, 'CREATE', 'Waitlist offer booked', null, String(result.appointment.id), user.clinic);
      return Response.json(result);
    }

    const result = await declineOffer(user.tenantId, offerId);
    if (!result) return Response.json({ error: 'Offer not found or already resolved' }, { status: 404 });

    await appendAudit(user, 'UPDATE', 'Waitlist offer declined', 'sent', 'declined', user.clinic);
    return Response.json(result);
  },
);
