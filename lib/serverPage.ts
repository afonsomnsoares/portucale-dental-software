import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type AuthRequest, getAuth, type SessionUser, scopeTenant } from './auth';
import { hasPermission, revalidateSession } from './permissions';

// ─── O withRoute das PÁGINAS ────────────────────────────────────────────────
// Uma página que lê a base de dados diretamente, em vez de passar por /api/,
// tem exatamente o mesmo problema que lib/route.ts foi escrito para resolver: o
// preâmbulo — autenticar, revalidar a sessão contra a base, verificar a ação,
// resolver a clínica — deixa de estar escrito num sítio e passa a estar copiado
// em cada ficheiro. E uma cópia esquecida não falha: serve os dados.
//
// Isso seria pior aqui do que nas rotas. Uma rota sem verificação ainda é uma
// rota que alguém tem de chamar; uma PÁGINA sem verificação renderiza os dados
// de outra clínica no ecrã de quem abriu o URL.
//
// Por isso este ficheiro existe antes de qualquer página o usar, e a assinatura
// é a mesma união discriminada: cada página diz em que regime vive, e não há um
// quinto caso.
//
// ─── O que NÃO está aqui ────────────────────────────────────────────────────
// O teto de escrita e o same-origin. Uma página é um GET de navegação: não
// escreve, e não há credencial ambiente que um site terceiro possa aproveitar
// para provocar uma. As escritas continuam todas em /api/, atrás do withRoute.

type PageOptions =
  | { permission: string; tenant?: 'required' | 'optional' }
  | { authOnly: string; tenant?: 'required' | 'optional' };

export interface PageContext {
  user: SessionUser;
  /** Já resolvido, incluindo o cookie acting_tenant do super-admin. */
  tenantId: string;
}

/**
 * Constrói o objeto que o lib/auth.ts espera a partir dos cookies do pedido.
 *
 * O `getAuth` recebe qualquer coisa com `.cookies.get()` e `.headers.get()` —
 * foi escrito assim para o NextRequest das rotas, e é isso que permite
 * reaproveitá-lo aqui sem lhe tocar. Continua a ser ele a chamar o
 * `enterTenantContext`, por isso o contexto de RLS do lib/db.ts fica primado
 * para todas as consultas que a página fizer a seguir.
 */
async function authRequestFromCookies(): Promise<AuthRequest> {
  const store = await cookies();
  return {
    cookies: { get: (name: string) => store.get(name) },
    headers: new Headers(),
  } as unknown as AuthRequest;
}

/**
 * Autentica, autoriza e resolve a clínica de uma página de servidor.
 *
 * Redireciona em vez de devolver um erro: quem está sem sessão vai para o
 * login, e quem não tem a ação vai para a raiz do dashboard — que é o que o
 * app/dashboard/layout.tsx já faz do lado do cliente. Uma página não tem onde
 * mostrar um 403 que faça sentido a alguém.
 */
export async function requirePage(options: PageOptions): Promise<PageContext> {
  const request = await authRequestFromCookies();
  const user = getAuth(request);
  if (!user) redirect('/');

  if ('permission' in options) {
    if (!(await hasPermission(user, options.permission))) redirect('/dashboard');
  } else {
    // Os três modos autenticados revalidam a sessão contra a base antes de
    // decidir — o `hasPermission` fá-lo lá dentro, o `authOnly` tem de o fazer
    // aqui para não ser o único caminho por onde um token de uma conta
    // desativada ainda passaria.
    if (!(await revalidateSession(user))) redirect('/');
  }

  const tenantId = scopeTenant(user, request);
  if (!tenantId && (options.tenant ?? 'required') !== 'optional') redirect('/dashboard');

  return { user, tenantId: tenantId ?? '' };
}
