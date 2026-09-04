import { appendAudit } from '@/lib/audit';
import { conflict } from '@/lib/http';
import { withRoute } from '@/lib/route';
import type { BookOfferError } from '@/lib/slotOffers';
import { acceptOfferAndBook, declineOffer, notifyWaitlistOfFreedSlot, recordOfferBooking } from '@/lib/waitlist';

// As mensagens dos casos em que a oferta já não se pode aceitar. Antes só havia
// um ("não existe"), porque só uma pessoa a olhar para a página é que aceitava
// ofertas e ela via o estado em tempo real. Com o webhook de SMS a poder aceitar
// horas depois (app/api/webhooks/sms/route.ts), o horário pode ter sido ocupado
// entretanto — e "não encontrado" seria uma explicação errada.
const ERROR_MESSAGE: Record<BookOfferError, { message: string; status: number }> = {
  not_found: { message: 'Oferta não encontrada.', status: 404 },
  not_pending: { message: 'Esta oferta já foi respondida.', status: 409 },
  expired: { message: 'Esta oferta expirou.', status: 409 },
  slot_taken: { message: 'Este horário deixou de estar disponível — foi ocupado entretanto.', status: 409 },
  no_patient: { message: 'O doente desta oferta já não existe.', status: 404 },
};

export const PUT = withRoute<{ id: string; offerId: string }>(
  { permission: 'waitlist:manage' },
  async ({ request, user, tenantId, params }) => {
    const { action } = await request.json();
    if (!['book', 'decline'].includes(action)) {
      return Response.json({ error: "action must be 'book' or 'decline'" }, { status: 400 });
    }

    if (action === 'book') {
      const outcome = await acceptOfferAndBook(tenantId, params.offerId);
      if (!outcome.ok) {
        const { message, status } = ERROR_MESSAGE[outcome.error];
        return status === 409 ? conflict(message) : Response.json({ error: message }, { status });
      }

      await recordOfferBooking(outcome.result, user);

      // Antecipação: a consulta antiga saiu, e o espaço que ela deixou é uma
      // vaga como qualquer outra — vai à lista de espera antes de ficar vazia.
      const released = outcome.result.releasedSlot;
      if (released) {
        await notifyWaitlistOfFreedSlot(tenantId, released, released.cancellationId).catch((e) => {
          console.error('notifyWaitlistOfFreedSlot (antecipação) falhou:', e instanceof Error ? e.message : e);
        });
      }
      return Response.json(outcome.result);
    }

    const result = await declineOffer(tenantId, params.offerId);
    if (!result) return Response.json({ error: 'Oferta não encontrada ou já respondida.' }, { status: 404 });

    await appendAudit(user, 'UPDATE', 'Oferta de vaga recusada', 'sent', 'declined', user.clinic);
    return Response.json(result);
  },
);
