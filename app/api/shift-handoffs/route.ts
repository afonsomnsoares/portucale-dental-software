import { appendAudit } from '@/lib/audit';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { createHandoff, listHandoffs } from '@/lib/shiftHandoff';
import { SHIFT_LABELS } from '@/lib/shiftHandoffCalc';
import { getOwnedUser } from '@/lib/tenantGuard';
import { asDate, asEnum, sanitizeString } from '@/lib/validate';

const STATUSES = ['open', 'acknowledged'] as const;

// 'resolved' faz o que o scopeTenant à mão aqui dentro fazia — incluindo ler o
// ?tenantId= do super-admin — mas com o cookie acting_tenant a ganhar-lhe, e com o 403
// de «sem clínica não há passagem de turno» a vir do wrapper.
export const GET = withRoute(
  { permission: 'shift-handoffs:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const rows = await listHandoffs(tenantId, {
      date: asDate(searchParams.get('date')),
      status: status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : null,
      // ?scope=forMe — o que o turno que entra precisa de ver. Um super_admin não faz
      // turnos, por isso o filtro só faz sentido para quem tem clínica própria — e é
      // por isso que esta linha lê `user.tenantId` e não o `tenantId` acima: a pergunta
      // aqui não é «de que clínica falamos», é «esta pessoa faz turnos nela».
      forUserId: searchParams.get('scope') === 'forMe' && user.tenantId ? user.id : null,
    });
    return Response.json(rows);
  },
);

export const POST = withRoute(
  { permission: 'shift-handoffs:manage', tenant: 'required' },
  async ({ request, user, tenantId }) => {
    // Uma passagem de turno é sempre escrita por quem fez o turno — from_user_id é
    // o próprio, nunca um id vindo do cliente. Um super_admin não tem turno numa
    // clínica, por isso não pode escrever passagens.

    const body = await request.json();
    const handoffDate = asDate(body.handoffDate) || new Date().toLocaleDateString('en-CA');
    const shiftLabel = body.shiftLabel ? asEnum(body.shiftLabel, SHIFT_LABELS) : 'other';
    if (body.shiftLabel && !shiftLabel) return badRequest(`shiftLabel must be one of: ${SHIFT_LABELS.join(', ')}`);

    const items = Array.isArray(body.items)
      ? body.items
          .map((i: unknown) => sanitizeString(i, 500))
          .filter((i: string) => !!i)
          .slice(0, 100)
      : [];
    const notes = sanitizeString(body.notes, 5000);
    if (!items.length && !notes) return badRequest('A handoff needs at least one item or a note');

    // Id de utilizador vindo do cliente — confirmar que é desta clínica (ver getOwnedUser).
    // Sem isto, um toUserId de outra clínica era aceite pela FK global de users e o nome
    // desse utilizador ficava exposto a esta clínica em listHandoffs (fuga entre tenants).
    let toUserId: string | null = null;
    if (body.toUserId) {
      const target = await getOwnedUser(body.toUserId, { tenantId });
      if (!target) return badRequest('toUserId is not a user in this clinic');
      toUserId = target.id;
    }

    const row = await createHandoff(tenantId, user.id, {
      handoffDate,
      shiftLabel: (shiftLabel || 'other') as (typeof SHIFT_LABELS)[number],
      toUserId,
      notes,
      items,
    });

    await appendAudit(
      user,
      'CREATE',
      `Shift handoff: ${handoffDate} ${shiftLabel}`,
      null,
      `${items.length} items`,
      user.clinic,
    );
    return created(row);
  },
);
