import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asDate, asTime, requireFields } from '@/lib/validate';
import { addToWaitlist, listPendingOffers, listWaitlist } from '@/lib/waitlist';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'waitlist:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const [entries, offers] = await Promise.all([listWaitlist(user.tenantId, status), listPendingOffers(user.tenantId)]);
  return Response.json({ entries, pendingOffers: offers });
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'waitlist:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  const missing = requireFields(body, ['patientId', 'treatmentType']);
  if (missing.length)
    return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });

  if (body.preferredTimeStart && !asTime(body.preferredTimeStart)) {
    return Response.json({ error: 'Invalid preferredTimeStart (use HH:MM)' }, { status: 400 });
  }
  if (body.preferredTimeEnd && !asTime(body.preferredTimeEnd)) {
    return Response.json({ error: 'Invalid preferredTimeEnd (use HH:MM)' }, { status: 400 });
  }
  if (body.maxWaitUntil && !asDate(body.maxWaitUntil)) {
    return Response.json({ error: 'Invalid maxWaitUntil (use YYYY-MM-DD)' }, { status: 400 });
  }
  const preferredDays = Array.isArray(body.preferredDays)
    ? body.preferredDays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
    : null;

  if (!(await getOwnedPatient(body.patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const row = await addToWaitlist(user.tenantId, user.id, {
    patientId: body.patientId,
    treatmentType: String(body.treatmentType).slice(0, 200),
    preferredDentistId: body.preferredDentistId || null,
    preferredDays,
    preferredTimeStart: body.preferredTimeStart || null,
    preferredTimeEnd: body.preferredTimeEnd || null,
    minDuration: body.minDuration,
    maxWaitUntil: body.maxWaitUntil || null,
    notes: String(body.notes || '').slice(0, 1000),
  });

  await appendTimeline(body.patientId, user, 'admin', `Adicionado à lista de espera: ${body.treatmentType}`);
  await appendAudit(user, 'CREATE', `Waitlist: ${body.treatmentType}`, null, `patient:${body.patientId}`, user.clinic);

  return Response.json(row, { status: 201 });
}
