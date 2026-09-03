import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { revalidateSession } from '@/lib/permissions';
import { computeTeamRoster } from '@/lib/staffSchedule';
import { asDate } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  // A sessão pode ter sido desativada, despromovida ou movida de clínica depois de o
  // token ser assinado; revalidateSession() confirma-o contra `users` e realinha
  // user.role/user.tenantId. Ver lib/permissions.ts.
  if (!(await revalidateSession(user))) return unauthorized();
  const { searchParams } = new URL(request.url);
  // Same convention as the other admin-config routes: a super_admin (no tenantId of
  // their own) must pick one via ?tenantId=.
  const tenantId = user.tenantId || (user.role === 'super_admin' ? searchParams.get('tenantId') : null);
  if (!tenantId) return forbidden();

  const date = asDate(searchParams.get('date')) || new Date().toLocaleDateString('en-CA');

  const { rows, coverageWarnings } = await computeTeamRoster(tenantId, date);
  return Response.json({ date, rows, coverageWarnings });
}
