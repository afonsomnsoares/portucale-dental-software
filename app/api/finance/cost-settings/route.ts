import { appendAudit } from '@/lib/audit';
import { getCostSettings, saveCostSettings } from '@/lib/costing';
import {
  ALLOCATION_METHOD_LABELS,
  ALLOCATION_METHOD_NOTES,
  ALLOCATION_METHODS,
  isAllocationMethod,
} from '@/lib/costingCalc';
import { withRoute } from '@/lib/route';

// Ler vai com 'finance:read'; escrever exige 'costs:manage'. Mudar a base de imputação
// muda o número que toda a gente lê, em todos os relatórios e retroativamente — não é
// uma preferência de ecrã.
export const GET = withRoute({ permission: 'finance:read' }, async ({ tenantId }) => {
  const settings = await getCostSettings(tenantId);
  return Response.json({
    settings,
    methods: ALLOCATION_METHODS.map((m) => ({
      value: m,
      label: ALLOCATION_METHOD_LABELS[m],
      note: ALLOCATION_METHOD_NOTES[m],
    })),
  });
});

export const PUT = withRoute({ permission: 'costs:manage' }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });
  if (body.allocationMethod !== undefined && !isAllocationMethod(body.allocationMethod)) {
    return Response.json({ error: `allocationMethod tem de ser: ${ALLOCATION_METHODS.join(', ')}` }, { status: 400 });
  }
  for (const field of ['fixedCostMonthly', 'labourCostPerHour'] as const) {
    const v = body[field];
    if (v !== undefined && v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      return Response.json({ error: `${field} tem de ser um número não negativo` }, { status: 400 });
    }
  }
  const row = await saveCostSettings(tenantId, user.id, {
    allocationMethod: body.allocationMethod,
    fixedCostMonthly: body.fixedCostMonthly == null ? undefined : Number(body.fixedCostMonthly),
    labourCostPerHour: body.labourCostPerHour == null ? undefined : Number(body.labourCostPerHour),
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  await appendAudit(user, 'UPDATE', `Definições de custo: ${row?.allocation_method}`, null, 'ok', user.clinic);
  return Response.json({ settings: await getCostSettings(tenantId) });
});
