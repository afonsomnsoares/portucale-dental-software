import { logBlockedAccess } from '@/lib/audit';
import { forbidden, requireRoles, type SessionUser, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

// Porteiro comum às rotas /api/platform/*. Estas leem ACIMA da clínica — todas as
// clínicas de uma vez — por isso não podem aceitar 'admin', nem sequer um admin com
// 'tenants:manage' concedido por role_permissions. É o mesmo raciocínio (e a mesma
// forma) do requireSuperAdmin local de app/api/tenants/route.ts, extraído aqui porque
// passou a haver cinco rotas a precisar dele em vez de uma.
//
// Devolve uma Response quando barra, ou null quando deixa passar.
export async function requirePlatform(user: SessionUser | null, permission?: string): Promise<Response | null> {
  if (!user) return unauthorized();
  if (!requireRoles(user, 'super_admin')) {
    await logBlockedAccess(user, 'Leitura de plataforma bloqueada: quem chama não é super-admin');
    return forbidden();
  }
  if (permission && !(await hasPermission(user, permission))) return forbidden();
  return null;
}
