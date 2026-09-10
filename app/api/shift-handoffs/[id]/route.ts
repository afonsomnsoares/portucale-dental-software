import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { apiError, notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { acknowledgeHandoff, getHandoff } from '@/lib/shiftHandoff';

// A única mutação possível é confirmar a leitura. Não há PUT de conteúdo: uma
// passagem de turno é o que ficou dito na altura, e reescrevê-la depois de o
// turno seguinte a ter lido tornaria a confirmação inútil.
export const PUT = withRoute<{ id: string }>(
  { permission: 'shift-handoffs:manage', tenant: 'optional' },
  async ({ user, params }) => {
    if (!user.tenantId) return forbidden();
    const { id } = params;

    const prev = await getHandoff(user.tenantId, id);
    if (!prev) return notFound('Handoff not found');

    const row = await acknowledgeHandoff(user.tenantId, id, user.id);
    if (!row) {
      // Distingue os dois casos que acknowledgeHandoff colapsa em null, para a UI
      // poder dizer porquê em vez de mostrar um erro genérico.
      if (prev.from_user_id === user.id) {
        return apiError({ status: 403, code: 'FORBIDDEN', message: 'Quem escreve a passagem não a pode confirmar' });
      }
      return apiError({ status: 409, code: 'CONFLICT', message: 'Passagem já confirmada' });
    }

    await appendAudit(user, 'UPDATE', `Shift handoff: ${prev.handoff_date}`, 'open', 'acknowledged', user.clinic);
    return Response.json(row);
  },
);
