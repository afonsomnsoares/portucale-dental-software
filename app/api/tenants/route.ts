import { appendAudit } from '@/lib/audit';
import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Gerir clínicas é ação de plataforma, não de clínica — só role='super_admin' (ver
// scripts/migrations/017_super_admin_role.sql). Um admin de clínica com
// hasPermission('tenants:manage') concedido não pode listar nem criar outras clínicas,
// por isso 'admin' não é aceite aqui.
//
// O porteiro é o requirePlatform de lib/platform.ts, partilhado com as restantes
// rotas que leem acima da clínica.
export const GET = withRoute({ platform: 'tenants:manage', tenant: 'optional' }, async () => {
  const rows = await query(
    `SELECT t.*, (SELECT COUNT(*) FROM patients p WHERE p.tenant_id=t.id)::int as patients
     FROM tenants t ORDER BY t.created_at`,
  );
  return Response.json(rows);
});

export const POST = withRoute({ platform: 'tenants:manage', tenant: 'optional' }, async ({ request, user }) => {
  const { name, city, operatories } = await request.json();
  const ops = Math.max(1, Math.min(20, Number(operatories || 3)));
  const [t] = await query(
    `INSERT INTO tenants (name, city, operatories, status) VALUES ($1,$2,$3,'provisioning') RETURNING *`,
    [name, city, ops],
  );
  await appendAudit(user, 'PROVISION', `Tenant: ${name}`, null, 'provisioning');
  return Response.json(t, { status: 201 });
});
