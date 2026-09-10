import { ROLE_META } from '@/lib/constants';
import { queryRead, warnSchemaGap } from '@/lib/db';
import { defaultAllows, PERMISSION_ACTIONS } from '@/lib/permissions';
import { withRoute } from '@/lib/route';

// Os papéis vistos de cima: quantas pessoas têm cada um em toda a rede, o que cada um
// pode fazer por omissão, e em que clínicas é que essa omissão foi alterada.
//
// O último número é o que só se vê daqui. Cada clínica pode reescrever as permissões
// de um papel (role_permissions, UI de Permissões), e uma clínica que dê 'gdpr:manage'
// à receção fica invisível de dentro — de fora, é uma linha nesta tabela.
export const GET = withRoute({ platform: 'users:manage', tenant: 'optional' }, async () => {
  const safe = async (scope: string, sql: string) => {
    try {
      return await queryRead(sql);
    } catch (e) {
      warnSchemaGap(scope, e);
      return [];
    }
  };

  const [userCounts, overrides] = await Promise.all([
    safe(
      'roles.users',
      `SELECT u.role, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE u.active)::int AS active,
              COUNT(DISTINCT u.tenant_id)::int AS clinics
         FROM users u GROUP BY u.role`,
    ),
    safe(
      'roles.overrides',
      `SELECT rp.role, rp.action, rp.allowed, rp.tenant_id, t.name AS tenant_name
         FROM role_permissions rp LEFT JOIN tenants t ON t.id = rp.tenant_id
        ORDER BY t.name, rp.role, rp.action`,
    ),
  ]);

  const roles = Object.keys(ROLE_META).map((role) => {
    const counts = userCounts.find((c) => c.role === role);
    const mine = overrides.filter((o) => o.role === role);
    return {
      role,
      label: ROLE_META[role as keyof typeof ROLE_META].label,
      sub: ROLE_META[role as keyof typeof ROLE_META].sub,
      users: Number(counts?.total || 0),
      activeUsers: Number(counts?.active || 0),
      clinics: Number(counts?.clinics || 0),
      // Quantas das ações declaradas este papel tem por omissão.
      defaultActions: PERMISSION_ACTIONS.filter((a) => defaultAllows(role, a)).length,
      overrides: mine.map((o) => ({
        action: o.action,
        allowed: !!o.allowed,
        tenantName: o.tenant_name,
        // Só é desvio se contrariar a omissão — uma clínica pode ter gravado uma linha
        // que apenas confirma o que já era, e isso não é notícia.
        deviates: !!o.allowed !== defaultAllows(role, String(o.action)),
      })),
    };
  });

  return Response.json({ roles, totalActions: PERMISSION_ACTIONS.length });
});
