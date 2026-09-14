import { computeClinicSummary } from '@/lib/reports';
import { withRoute } from '@/lib/route';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// `resolved` e não `required`: o seletor de clínica de components/shared/Reports.tsx
// aparece SÓ ao super-admin sem clínica própria, e manda sempre `?tenantId=`. Sob
// `required`, o resolveTenantId de lib/route.ts fixa `requested = null` — o parâmetro
// que a página existe para enviar era ignorado, o scopeTenant devolvia null e a rota
// respondia 403 exatamente ao papel para quem o seletor foi feito. Metade da página
// (/api/reports/compare) já funcionava, por ser `optional`, o que tornava a falha
// parcial e mais fácil de ler como "não há dados".
//
// Continua fechado a quem não deve: o scopeTenant de lib/auth.ts só honra o
// `requested` quando o utilizador é super_admin SEM clínica sua — um utilizador de
// clínica recebe sempre a dele, e um não-super_admin sem clínica recebe null. É o
// mesmo modo de /api/permissions e /api/schema.
export const GET = withRoute({ permission: 'reports:read', tenant: 'resolved' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const from = clampDate(searchParams.get('from')) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(searchParams.get('to')) || new Date().toISOString().slice(0, 10);

  const summary = await computeClinicSummary(tenantId, from, to);
  if (!summary) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json(summary);
});
