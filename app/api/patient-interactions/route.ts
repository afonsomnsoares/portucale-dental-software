import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { badRequest, created } from '@/lib/http';
import { listInteractions, logInteraction } from '@/lib/patientInteractions';
import { hasPermission } from '@/lib/permissions';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asEnum, sanitizeString } from '@/lib/validate';

// Registo MANUAL do que aconteceu no mundo real, escrito por uma pessoa — não é o canal
// do agente. Por isso 'email' fica: um doente pode escrever à clínica quer o software o
// leia quer não. 'whatsapp' sai porque essa via deixa de existir de todo (migração 052).
const CHANNELS = ['phone', 'email', 'sms', 'in_person', 'other'] as const;
const DIRECTIONS = ['inbound', 'outbound'] as const;

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patient-interactions:read'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  if (!patientId) return badRequest('patientId is required');
  if (!(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const rows = await listInteractions(user.tenantId, patientId);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patient-interactions:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  if (!body.patientId) return badRequest('patientId is required');

  const summary = sanitizeString(body.summary, 2000);
  if (!summary) return badRequest('summary is required');

  const channel = asEnum(body.channel, CHANNELS);
  if (!channel) return badRequest(`channel must be one of: ${CHANNELS.join(', ')}`);
  const direction = body.direction ? asEnum(body.direction, DIRECTIONS) : 'outbound';
  if (body.direction && !direction) return badRequest(`direction must be one of: ${DIRECTIONS.join(', ')}`);

  if (!(await getOwnedPatient(body.patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const row = await logInteraction(user.tenantId, user.id, {
    patientId: body.patientId,
    channel,
    direction: direction || 'outbound',
    summary,
    occurredAt: body.occurredAt || null,
  });

  await appendTimeline(body.patientId, user, 'interaction', `${channelLabel(channel)}: ${summary}`);
  await appendAudit(user, 'CREATE', `Patient interaction: ${channel}`, null, `patient:${body.patientId}`, user.clinic);

  return created(row);
}

function channelLabel(channel: string) {
  const LABELS: Record<string, string> = {
    phone: 'Chamada',
    email: 'Email',
    sms: 'SMS',
    in_person: 'Presencial',
    other: 'Outro',
  };
  return LABELS[channel] || channel;
}
