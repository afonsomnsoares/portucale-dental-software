import { computeEquipmentOverview, listMaintenance, logMaintenance } from '@/lib/equipment';
import { badRequest, created, notFound, ok } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asDate, asEnum, asFee, sanitizeString } from '@/lib/validate';

// Histórico de assistências de um equipamento (migração 043). Registar uma intervenção
// adianta o relógio da próxima — as duas coisas na mesma transação, ver logMaintenance
// em lib/equipment.ts.
const KINDS = ['preventive', 'corrective', 'inspection'] as const;
const STATUSES = ['operational', 'maintenance', 'broken'] as const;

export const GET = withRoute<{ id: string }>({ permission: 'equipment:manage' }, async ({ tenantId, params }) => {
  const overview = await computeEquipmentOverview(tenantId);
  const equipment = overview.find((e) => e.id === params.id);
  if (!equipment) return notFound('Equipamento não encontrado');
  return ok({ equipment, history: await listMaintenance(tenantId, params.id) });
});

export const POST = withRoute<{ id: string }>(
  { permission: 'equipment:manage' },
  async ({ request, user, tenantId, params }) => {
    const body = await request.json().catch(() => ({}));

    const servicedAt = asDate(body.servicedAt) || new Date().toLocaleDateString('en-CA');
    const kind = body.kind ? asEnum(body.kind, KINDS) : 'preventive';
    if (body.kind && !kind) return badRequest(`kind must be one of: ${KINDS.join(', ')}`);

    // Custo é opcional, mas se vier tem de ser um número — um valor que alguém escreveu
    // e o sistema descartou em silêncio é pior do que um erro.
    let cost: number | null = null;
    if (body.cost !== undefined && body.cost !== null && String(body.cost).trim() !== '') {
      cost = asFee(body.cost);
      if (cost === null || cost < 0) return badRequest('O custo tem de ser um número igual ou maior que zero');
    }

    const setStatus = body.setStatus ? asEnum(body.setStatus, STATUSES) : null;
    if (body.setStatus && !setStatus) return badRequest(`setStatus must be one of: ${STATUSES.join(', ')}`);

    const result = await logMaintenance(tenantId, params.id, user.id || null, {
      servicedAt,
      kind: (kind || 'preventive') as (typeof KINDS)[number],
      technician: sanitizeString(body.technician, 200),
      cost,
      notes: sanitizeString(body.notes, 2000),
      setStatus: (setStatus as (typeof STATUSES)[number]) || undefined,
    });
    if ('error' in result) return notFound('Equipamento não encontrado');

    return created(result);
  },
);
