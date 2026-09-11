import { cookies } from 'next/headers';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { ACTING_TENANT_COOKIE, forbidden, requireRoles } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Entrar numa clínica e sair dela.
//
// O super_admin não tem clínica própria (users_role_tenant_consistency), pelo que até aqui
// via cada clínica através de 12 páginas espelhadas em components/super-admin/pages/, cada
// uma com o seu seletor em estado local — que se perdia a cada navegação, e que fez as duas
// árvores divergirem ao ponto de uma estar em português e a outra em inglês.
//
// Em vez disso, entra na clínica: grava-se aqui a clínica ativa e ele passa a usar as
// páginas do próprio admin (/dashboard/admin/*, ver DASHBOARD_ACCESS em proxy.ts).
// lib/auth.ts:scopeTenant lê o cookie, e só para quem é super_admin.
//
// Entrar e sair ficam no audit_log: é o operador da plataforma a ir ver dados clínicos de
// um cliente, e isso tem de deixar rasto.

// 'optional' e não 'resolved': esta é a rota que ESCREVE o cookie acting_tenant, por
// isso a clínica de destino vem do corpo e é a única fonte possível — resolvê-la pelo
// wrapper seria pedir-lhe a resposta a uma pergunta que só este pedido vai criar.
export const POST = withRoute({ platform: true, tenant: 'optional' }, async ({ request, user }) => {
  if (!requireRoles(user, 'super_admin')) {
    await logBlockedAccess(user, 'Clinic impersonation blocked: caller is not a super-admin');
    return forbidden();
  }

  const { tenantId } = await request.json().catch(() => ({ tenantId: null }));
  if (!tenantId) return Response.json({ error: 'tenantId is required' }, { status: 400 });

  // A clínica tem de existir — sem isto, um id inventado dava um contexto que filtra por
  // uma clínica inexistente, ou seja páginas vazias sem explicação.
  const tenant = await queryOne(`SELECT id, name FROM tenants WHERE id=$1`, [tenantId]);
  if (!tenant) return Response.json({ error: 'Clinic not found' }, { status: 404 });

  const cookieStore = await cookies();
  cookieStore.set(ACTING_TENANT_COOKIE, tenant.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // um dia de trabalho; se ficar esquecido, expira sozinho
  });

  await appendAudit(user, 'IMPERSONATE', `Entrou na clínica — ${tenant.name}`, null, tenant.id, tenant.name);
  return Response.json({ tenantId: tenant.id, tenantName: tenant.name });
});

export const DELETE = withRoute({ platform: true, tenant: 'optional' }, async ({ user }) => {
  if (!requireRoles(user, 'super_admin')) return forbidden();

  const cookieStore = await cookies();
  cookieStore.delete(ACTING_TENANT_COOKIE);
  await appendAudit(user, 'IMPERSONATE', 'Saiu da clínica', null, null, null);
  return Response.json({ ok: true });
});
