import type { NextRequest } from 'next/server';
import { forbidden, getAuth, scopeTenant, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeScheduleOptimization } from '@/lib/scheduleOptimizer';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário". Read-only por
// desenho: devolve propostas, nunca as aplica. Mover uma consulta obriga a
// avisar o doente, e essa decisão é de quem atende — ver o cabeçalho de
// lib/scheduleOptimizer.ts.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'schedule:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = scopeTenant(user, request, requestedTenantId);
  if (!tenantId) return forbidden();

  const daysRaw = Number(searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;

  const data = await computeScheduleOptimization(tenantId, days);
  return Response.json(data);
}
