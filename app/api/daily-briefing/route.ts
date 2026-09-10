import { forbidden } from '@/lib/auth';
import { computeDailyBriefing } from '@/lib/dailyBriefing';
import { withRoute } from '@/lib/route';
import { asDate } from '@/lib/validate';

// Read-only — no permission gate beyond having a session, same as GET /api/appointments
// (which this mirrors: same tenant+date scoping, same "everyone sees the whole day by
// default" convention as app/dashboard/dentist/page.tsx already relies on). ?dentistId=
// narrows to one dentist's own patients when passed; nobody's forced into that filter.
export const GET = withRoute(
  {
    authOnly: 'Resumo do próprio dia de quem chama, montado a partir do que essa pessoa já pode ver noutras rotas',
    tenant: 'optional',
  },
  async ({ request, user }) => {
    if (!user.tenantId) return forbidden();

    const { searchParams } = new URL(request.url);
    const date = asDate(searchParams.get('date')) || new Date().toISOString().slice(0, 10);
    const dentistId = searchParams.get('dentistId') || null;

    const rows = await computeDailyBriefing(user.tenantId, date, dentistId);
    return Response.json({ date, rows });
  },
);
