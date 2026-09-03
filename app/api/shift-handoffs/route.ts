import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { createHandoff, listHandoffs } from '@/lib/shiftHandoff';
import { SHIFT_LABELS } from '@/lib/shiftHandoffCalc';
import { getOwnedUser } from '@/lib/tenantGuard';
import { asDate, asEnum, sanitizeString } from '@/lib/validate';

const STATUSES = ['open', 'acknowledged'] as const;

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'shift-handoffs:manage'))) return forbidden();
  const { searchParams } = new URL(request.url);
  const tenantId = user.tenantId || (user.role === 'super_admin' ? searchParams.get('tenantId') : null);
  if (!tenantId) return forbidden();

  const status = searchParams.get('status');
  const rows = await listHandoffs(tenantId, {
    date: asDate(searchParams.get('date')),
    status: status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : null,
    // ?scope=forMe — o que o turno que entra precisa de ver. Um super_admin não
    // faz turnos, por isso o filtro só faz sentido para quem tem tenant próprio.
    forUserId: searchParams.get('scope') === 'forMe' && user.tenantId ? user.id : null,
  });
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'shift-handoffs:manage'))) return forbidden();
  // Uma passagem de turno é sempre escrita por quem fez o turno — from_user_id é
  // o próprio, nunca um id vindo do cliente. Um super_admin não tem turno numa
  // clínica, por isso não pode escrever passagens.
  if (!user.tenantId) return forbidden();

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
    const target = await getOwnedUser(body.toUserId, user);
    if (!target) return badRequest('toUserId is not a user in this clinic');
    toUserId = target.id;
  }

  const row = await createHandoff(user.tenantId, user.id, {
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
}
