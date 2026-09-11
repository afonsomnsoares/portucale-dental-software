import { appendAudit } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { getPreferences, upsertPreferences } from '@/lib/schedulingPrefs';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { asInt, asTime, sanitizeString } from '@/lib/validate';

// Item 9 — "preferências dos pacientes". Recurso irmão de
// app/api/patients/[id]/next-action, pela mesma razão: é um perfil próprio, e
// dobrá-lo dentro de GET /api/patients/[id] encareceria a listagem/pesquisa que
// nunca precisa disto.
//
// Ler exige apenas 'schedule:read' (quem marca precisa de saber), escrever exige
// 'patients:update' — é uma alteração à ficha do doente, não uma preferência de
// operação interna.

function parseDays(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  const days = v.map((d) => asInt(d, { min: 0, max: 6 })).filter((d): d is number => d !== null);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : null;
}

export const GET = withRoute<{ id: string }>(
  { permission: 'schedule:read', tenant: 'optional' },
  async ({ params, tenantId }) => {
    const { id } = params;

    const patient = await getOwnedPatient(id, { tenantId });
    if (!patient) return notFound('Patient not found');

    const row = await getPreferences(String(patient.tenant_id), String(patient.id));
    // null (não 404) quando nunca foi definido nada: a ausência de perfil é um
    // estado normal, não um erro — a UI mostra o formulário vazio.
    return Response.json(row || null);
  },
);

export const PUT = withRoute<{ id: string }>(
  { permission: 'patients:update', tenant: 'optional' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;

    const patient = await getOwnedPatient(id, { tenantId });
    if (!patient) return notFound('Patient not found');

    const body = await request.json();
    const start = body.preferredTimeStart ? asTime(body.preferredTimeStart) : null;
    const end = body.preferredTimeEnd ? asTime(body.preferredTimeEnd) : null;
    if (body.preferredTimeStart && !start) return badRequest('preferredTimeStart must be HH:MM');
    if (body.preferredTimeEnd && !end) return badRequest('preferredTimeEnd must be HH:MM');
    // Mesma regra do CHECK na migração 032 — validada aqui também para dar uma
    // mensagem legível em vez de um erro de constraint do Postgres.
    if (start && end && end <= start) return badRequest('preferredTimeEnd must be after preferredTimeStart');

    if (body.preferredDays !== undefined && body.preferredDays !== null && !Array.isArray(body.preferredDays)) {
      return badRequest('preferredDays must be an array of 0-6 weekday numbers');
    }

    const row = await upsertPreferences(String(patient.tenant_id), String(patient.id), user.id, {
      preferredDentistId: body.preferredDentistId ? String(body.preferredDentistId) : null,
      preferredDays: parseDays(body.preferredDays),
      preferredTimeStart: start,
      preferredTimeEnd: end,
      notes: sanitizeString(body.notes, 500),
    });

    await appendAudit(user, 'UPDATE', 'Patient scheduling preferences', null, `patient:${patient.id}`, user.clinic);
    return Response.json(row);
  },
);
