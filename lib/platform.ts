import { logBlockedAccess } from '@/lib/audit';
import { forbidden, requireRoles, type SessionUser, unauthorized } from '@/lib/auth';
import { hasPermission, revalidateSession } from '@/lib/permissions';

// Porteiro comum às rotas /api/platform/*. Estas leem ACIMA da clínica — todas as
// clínicas de uma vez — por isso não podem aceitar 'admin', nem sequer um admin com
// 'tenants:manage' concedido por role_permissions. É o mesmo raciocínio (e a mesma
// forma) do requireSuperAdmin local de app/api/tenants/route.ts, extraído aqui porque
// passou a haver cinco rotas a precisar dele em vez de uma.
//
// Devolve uma Response quando barra, ou null quando deixa passar.
export async function requirePlatform(user: SessionUser | null, permission?: string): Promise<Response | null> {
  if (!user) return unauthorized();

  // ─── Revalidar ANTES de olhar para o papel ───────────────────────────────
  // Isto decidia a partir do `role` que vinha no token, e só chegava a
  // `revalidateSession` (lá dentro do `hasPermission`) quando havia uma permissão
  // nomeada. As quatro rotas que declaram `platform: true` não nomeiam nenhuma —
  // platform/health, platform/system-config, e o entrar/sair de uma clínica — por
  // isso nunca revalidavam, ao contrário do que o invariante escrito em
  // lib/route.ts afirma sobre os três modos autenticados.
  //
  // O que isso queria dizer na prática: desativar um super-admin ou mudar-lhe a
  // password — as duas respostas de incidente — não revogava nada nessas quatro
  // rotas até o token expirar por si (7 dias, por omissão). Quem tivesse o token
  // continuava a ler configuração da plataforma e a entrar em clínicas.
  const live = await revalidateSession(user);
  if (!live) {
    await logBlockedAccess(user, 'Leitura de plataforma bloqueada: sessão já não é válida');
    return unauthorized();
  }

  // `requireRoles` sobre o utilizador já realinhado: quem foi despromovido a meio
  // da validade do token passa a ser barrado aqui, e não daqui a uma semana.
  if (!requireRoles(user, 'super_admin')) {
    await logBlockedAccess(user, 'Leitura de plataforma bloqueada: quem chama não é super-admin');
    return forbidden();
  }
  if (permission && !(await hasPermission(user, permission))) return forbidden();
  return null;
}
