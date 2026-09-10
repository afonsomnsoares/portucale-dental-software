import { cookies } from 'next/headers';
import { actingTenantId, unauthorized } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { effectiveActions } from '@/lib/permissions';
import { withRoute } from '@/lib/route';

export const GET = withRoute(
  {
    authOnly:
      'O próprio perfil de quem chama e as suas ações efetivas. Não há permissão ' +
      'que faça sentido exigir para alguém se ver a si mesmo — e a Sidebar precisa ' +
      'disto para saber o que esconder',
    tenant: 'optional',
  },
  async ({ request, user: session }) => {
    const user = await queryOne(
      `SELECT u.id, u.email, u.name, u.role, u.clinic, u.tenant_id, u.active,
            t.name as tenant_name, t.city as tenant_city,
            COALESCE(t.operatories, 3) as operatories
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id=$1 AND u.active=TRUE`,
      [session.id],
    );

    if (!user) {
      const cookieStore = await cookies();
      cookieStore.delete('dent_token');
      return unauthorized();
    }

    // Clínica em que o super_admin entrou, se alguma — a faixa de aviso do dashboard
    // precisa do nome, e a sidebar precisa de saber que está lá dentro.
    const activeTenant = user.role === 'super_admin' ? actingTenantId(request) : null;
    const acting = activeTenant
      ? await queryOne(`SELECT id, name FROM tenants WHERE id=$1`, [activeTenant]).then((t) =>
          t ? { actingTenantId: t.id, actingTenantName: t.name } : {},
        )
      : {};

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        clinic: user.clinic,
        tenantId: user.tenant_id,
        tenantName: user.tenant_name,
        tenantCity: user.tenant_city,
        operatories: Number(user.operatories || 3),
        // Ações efetivas do próprio: a Sidebar usa-as para esconder as entradas que a pessoa
        // não pode usar. Antes decidia só pelo papel, pelo que os overrides por clínica não
        // tinham efeito nenhum no menu (link visível a levar a um 403).
        permissions: await effectiveActions(user.role, user.tenant_id),
        ...acting,
      },
    });
  },
);
