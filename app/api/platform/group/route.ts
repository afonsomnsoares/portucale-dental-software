import { computeGroupView } from '@/lib/group';
import { withRoute } from '@/lib/route';

// ─── A vista de grupo ───────────────────────────────────────────────────────
// Exige 'tenants:manage' — a única acção de plataforma (PLATFORM_ACTIONS em
// lib/permissions.ts), que só o super_admin tem. É deliberado e é a mesma regra dos
// insights do agente Grupo: uma clínica nunca lê o que o grupo sabe das outras, e uma
// permissão de clínica não pode abrir esta porta por engano.
export const GET = withRoute({ platform: 'tenants:manage', tenant: 'optional' }, async ({ request }) => {
  const daysRaw = Number(new URL(request.url).searchParams.get('days') || 14);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;
  return Response.json({ generatedAt: new Date().toISOString(), days, ...(await computeGroupView(days)) });
});
