import { withRoute } from '@/lib/route';
import { computeTeamRoster } from '@/lib/staffSchedule';
import { asDate } from '@/lib/validate';

export const GET = withRoute(
  {
    authOnly: 'Quem está de serviço hoje na própria clínica — informação de equipa, não de doente',
    tenant: 'required',
  },
  async ({ request, tenantId }) => {
    const { searchParams } = new URL(request.url);
    // Same convention as the other admin-config routes: a super_admin (no tenantId of
    // their own) must pick one via ?tenantId=.

    const date = asDate(searchParams.get('date')) || new Date().toLocaleDateString('en-CA');

    const { rows, coverageWarnings } = await computeTeamRoster(tenantId, date);
    return Response.json({ date, rows, coverageWarnings });
  },
);
