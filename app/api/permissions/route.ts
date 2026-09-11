import { appendAudit } from '@/lib/audit';
import { forbidden, requireRoles } from '@/lib/auth';
import { getPermissionMatrix, setPermissionOverrides } from '@/lib/permissions';
import { withRoute } from '@/lib/route';

// 'resolved' É esta regra: quem tem clínica usa sempre a sua e o ?tenantId= é
// ignorado; só o super-admin escolhe, e a clínica em que ele tenha entrado ganha
// à query string.
export const GET = withRoute({ permission: 'permissions:manage', tenant: 'resolved' }, async ({ user, tenantId }) => {
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();

  const data = await getPermissionMatrix(tenantId);
  return Response.json({ tenantId, ...data });
});

export const PUT = withRoute(
  { permission: 'permissions:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();

    const { tenantId: requestedTenantId, updates } = await request.json();
    // O wrapper já confinou `tenantId` à clínica de quem chama — o pedido de um admin
    // para editar outra é simplesmente ignorado. Ignorar não chega aqui: devolveríamos
    // a matriz da clínica dele com o nome da outra no corpo do pedido, e ele acharia
    // que tinha editado a outra. O 403 diz-lhe o que aconteceu.
    if (requestedTenantId && requestedTenantId !== tenantId) return forbidden();

    await setPermissionOverrides(tenantId, updates || []);
    await appendAudit(user, 'UPDATE', `Permissions — tenant ${tenantId}`, null, 'updated', user.clinic);

    const data = await getPermissionMatrix(tenantId);
    return Response.json({ tenantId, ...data });
  },
);
