import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, type SessionUser, scopeTenant, unauthorized } from './auth';
import { hasPermission, revalidateSession } from './permissions';
import { requirePlatform } from './platform';
import { rateLimitGlobal } from './rateLimitGlobal';

// Política de tenant da rota. Os três casos que existem em app/api/*:
//   'required' — a rota precisa de uma clínica concreta (o caso por omissão).
//   'optional' — o super-admin lê sem clínica (tenantId null = todas).
//   'resolved' — como 'required', mas o super-admin fora de uma clínica pode
//                escolhê-la por ?tenantId= ou no body. Substitui os 11
//                `resolveTenantId` locais que estavam copiados entre rotas.
type TenantPolicy = 'required' | 'optional' | 'resolved';

export interface RouteContext<P> {
  request: NextRequest;
  user: SessionUser;
  // Já resolvido segundo a política. Com 'required' e 'resolved' é sempre uma
  // string — o handler não precisa de o voltar a verificar, e o tipo garante
  // isso. Só 'optional' o pode entregar vazio, e aí significa "todas".
  tenantId: string;
  params: P;
}

// ─── Porque é que isto é uma união, e não um objeto com tudo opcional ───────
// A versão anterior declarava `{ permission?: string; public?: true }`, ou seja
// TODOS os campos opcionais — e por isso `withRoute({}, handler)` compilava sem
// uma queixa. A promessa escrita no comentário da função ("uma rota sem
// `permission` nem `public` nem sequer é aceite pelo TypeScript") era
// simplesmente falsa: o tipo não a impunha.
//
// Escrita como união discriminada, passa a ser verdade. Cada rota tem de dizer
// em qual dos quatro mundos vive, e não há um quinto:
//
//   permission — o caso normal: uma ação de lib/permissions.ts.
//   platform   — só super-admin (o que `requirePlatform` já fazia à mão).
//   authOnly   — autenticado, sem ação própria. Existe porque há rotas assim
//                (o meu próprio perfil, o catálogo da minha clínica), mas exige
//                uma frase a dizer porquê: uma saída de emergência que não custa
//                nada a usar é uma saída que se usa por preguiça.
//   public     — sem autenticação de todo. Login, /api/public/*, webhooks.
//
// Os `never` são o que faz o TypeScript recusar misturas — `{ permission: 'x',
// public: true }` deixa de compilar em vez de silenciosamente ignorar um dos dois.
type RouteOptions =
  | { permission: string; tenant?: TenantPolicy; platform?: never; authOnly?: never; public?: never }
  | { platform: string | true; tenant?: TenantPolicy; permission?: never; authOnly?: never; public?: never }
  | { authOnly: string; tenant?: TenantPolicy; permission?: never; platform?: never; public?: never }
  | { public: true; permission?: never; platform?: never; authOnly?: never; tenant?: never };

// Handler já autenticado, autorizado e com o tenant resolvido.
type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

// ─── Teto de escrita partilhado entre instâncias ────────────────────────────
// O travão genérico de /api/* vive no proxy, que corre no runtime Edge e por isso
// conta em memória, por instância (ver a nota em lib/rateLimit.ts). Com duas instâncias
// atrás de um balanceador, o limite efetivo passa a ser N × o configurado.
//
// Isto não resolve o caso Edge — não há como, sem Redis — mas fecha a metade que
// importa mais e que já era resolúvel com o que o projeto tem: as ESCRITAS. Os route
// handlers correm no runtime Node, com pool de ligações, por isso podem usar o contador
// partilhado em Postgres que lib/rateLimitGlobal.ts já implementava e que, até agora,
// nenhuma rota chamava — escrito e sem consumidores, exatamente como o canal SSE.
//
// Só mutações, por uma questão de custo: uma ida à base de dados por LEITURA duplicaria
// o número de consultas da aplicação inteira para proteger o que já é idempotente e já
// tem um travão por instância. As escritas são as que consomem, as que gravam e as que
// disparam automatismos.
const WRITE_LIMIT = { limit: 120, windowMs: 60 * 1000 };
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Resolução de clínica ───────────────────────────────────────────────────
// Delega em scopeTenant (lib/auth.ts) em vez de reimplementar a regra, e isso
// corrige um erro que a versão anterior tinha: scopeTenant honra o cookie
// `acting_tenant` — o "entrar na clínica" do super-admin, POST /api/tenants/enter
// — e a implementação local aqui não o lia. Uma rota migrada para withRoute
// deixava portanto de funcionar para um super-admin dentro de uma clínica, ao
// contrário das 36 rotas que chamavam scopeTenant diretamente. Os 11
// `resolveTenantId` copiados por app/api/ tinham o mesmo buraco.
//
// A precedência é a de scopeTenant, e é a única segura: quem tem clínica própria
// usa sempre a sua e o `?tenantId=` é ignorado — deixá-lo escolher outra seria um
// IDOR entre clínicas.
function resolveTenantId(
  request: NextRequest,
  user: SessionUser,
  policy: TenantPolicy,
  body: unknown,
): string | null | Response {
  const fromBody = (body as { tenantId?: unknown } | null)?.tenantId;
  const requested =
    policy === 'resolved'
      ? (typeof fromBody === 'string' && fromBody) || new URL(request.url).searchParams.get('tenantId')
      : null;
  const tenantId = scopeTenant(user, request, requested);
  // 'optional' é o único que aceita a ausência de clínica; nos outros dois, não
  // saber de que clínica falamos não é um pedido que se possa servir.
  if (!tenantId && policy !== 'optional') return forbidden();
  return tenantId;
}

// Aplica o modo de autorização declarado nas opções. Devolve uma Response quando
// bloqueia e null quando deixa passar.
//
// Os três modos autenticados revalidam a sessão contra a base de dados antes de
// decidir: `hasPermission` e `requirePlatform` já o faziam lá dentro, e o
// `authOnly` chama revalidateSession diretamente para não ser o único caminho por
// onde um token de uma conta entretanto desativada, despromovida ou movida de
// clínica ainda passaria. É também o que realinha `user.role`/`user.tenantId`
// (escreve no próprio objeto, ver lib/permissions.ts) antes de resolvermos a
// clínica logo a seguir — por isso corre sempre primeiro.
async function authorize(options: RouteOptions, user: SessionUser): Promise<Response | null> {
  if (options.platform !== undefined) {
    return requirePlatform(user, options.platform === true ? undefined : options.platform);
  }
  if (options.permission !== undefined) {
    return (await hasPermission(user, options.permission)) ? null : forbidden();
  }
  return (await revalidateSession(user)) ? null : unauthorized();
}

/**
 * Envolve um handler de rota com o preâmbulo que estava copiado por app/api/:
 * CSRF/same-origin, autenticação, revalidação de sessão, autorização, teto de
 * escrita partilhado e resolução de clínica.
 *
 * O ponto não é poupar linhas — é que a omissão deixa de ser silenciosa. Uma
 * rota escrita à mão sem `hasPermission` compila, passa nos testes e parece
 * igual às outras; a única defesa é alguém reparar na revisão. Aqui, a união
 * discriminada de `RouteOptions` obriga cada rota a declarar em que regime vive,
 * e `withRoute({}, handler)` não compila.
 *
 * Ordem, e cada passo depende do anterior:
 *
 *   1. same-origin  — no-op em GET/HEAD/OPTIONS, por isso não precisa de condição;
 *   2. getAuth      — e com ele o contexto de RLS do pedido (lib/db.ts);
 *   3. authorize    — revalida a sessão contra a base e realinha papel/clínica;
 *   4. teto de escrita — só em mutações, e só depois de sabermos que a pessoa
 *      podia mesmo fazer aquilo: gastar-lhe a quota num 403 repetido seria deixar
 *      um atacante esgotar o orçamento da própria vítima;
 *   5. resolução da clínica — sobre o papel/clínica já realinhados no passo 3.
 */
// P é a forma dos params da rota: `{ id: string }` num segmento dinâmico, `{}`
// numa rota estática. O default tem de ser `{}` e o segundo parâmetro tem de ser
// obrigatório: o Next 16 gera um validador (.next/types/validator.ts) que compara
// a assinatura exportada com `(request, context: { params: Promise<{}> })`, e um
// `ctx?:` opcional ou um default `undefined` fazem o `next build` falhar.
// biome-ignore lint/complexity/noBannedTypes: `{}` é a forma que o validador do Next exige para rotas sem params
export function withRoute<P = {}>(options: RouteOptions, handler: Handler<P>) {
  return async (request: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    // requireSameOrigin já é no-op em GET/HEAD/OPTIONS, por isso não precisa de
    // condição aqui — uma condição a menos é uma condição a menos para errar.
    const originCheck = requireSameOrigin(request);
    if (originCheck) return originCheck;

    if (options.public) {
      return handler({ request, user: null as never, tenantId: '', params: (await ctx?.params) as P });
    }

    const user = getAuth(request);
    if (!user) return unauthorized();

    const blocked = await authorize(options, user);
    if (blocked) return blocked;

    // Depois da autorização, de propósito: a chave é o utilizador autenticado, e gastar
    // orçamento de escrita de alguém antes de saber se ele sequer podia fazer aquilo
    // deixaria um 403 repetido a esgotar a quota da própria vítima.
    if (MUTATING_METHODS.has(request.method)) {
      const rl = await rateLimitGlobal(`write:${user.id}`, WRITE_LIMIT);
      if (!rl.ok) {
        return Response.json(
          { error: 'Demasiadas alterações seguidas. Aguarde um momento.', code: 'RATE_LIMIT' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
        );
      }
    }

    // O body é lido uma só vez e passado adiante: Request.json() só pode ser
    // consumido uma vez, e a política 'resolved' precisa de espreitar lá dentro.
    let body: unknown = null;
    const needsBody = options.tenant === 'resolved' && request.method !== 'GET';
    if (needsBody) body = await request.json().catch(() => null);

    const tenantId = resolveTenantId(request, user, options.tenant ?? 'required', body);
    if (tenantId instanceof Response) return tenantId;

    return handler({
      request: needsBody ? withParsedBody(request, body) : request,
      user,
      tenantId: tenantId as string,
      params: (await ctx?.params) as P,
    });
  };
}

// Devolve um NextRequest cujo .json() entrega o body já lido, para o handler
// poder chamar request.json() como sempre fez.
function withParsedBody(request: NextRequest, body: unknown): NextRequest {
  return new Proxy(request, {
    get(target, prop, receiver) {
      if (prop === 'json') return async () => body;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
