import { forbidden, scopeTenant } from '@/lib/auth';
import { withRoute } from '@/lib/route';
import { computeScheduleOptimization } from '@/lib/scheduleOptimizer';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário". Read-only por
// desenho: devolve propostas, nunca as aplica. Mover uma consulta obriga a
// avisar o doente, e essa decisão é de quem atende — ver o cabeçalho de
// lib/scheduleOptimizer.ts.
export const GET = withRoute({ permission: 'schedule:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const data = await computeScheduleOptimization(tenantId, days);
  return Response.json(data);
});
