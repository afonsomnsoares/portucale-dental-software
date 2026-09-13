import type { NextRequest } from 'next/server';
import { logBlockedAccess } from './audit';
import { forbidden, getAuth, requireSameOrigin, type SessionUser, scopeTenant, unauthorized } from './auth';
import { hasPermission, revalidateSession } from './permissions';
import { requirePlatform } from './platform';
import { getClientIp, rateLimit } from './rateLimit';
import { rateLimitGlobal } from './rateLimitGlobal';

// Política de tenant da rota. Os três casos que existem em app/api/*:
//   'required' — a rota precisa de uma clínica concreta (o caso por omissão).
//   'optional' — o super-admin lê sem clínica (tenantId null = todas).
//   'resolved' — como 'required', mas o super-admin fora de uma clínica pode
//                escolhê-la por ?tenantId= ou no body.
//
// ─── Nenhuma rota deriva o âmbito de `user.tenantId` ───────────────────────
// Esse valor vem do token, e para o super-admin é sempre null por construção —
// mesmo quando ele está DENTRO de uma clínica (cookie acting_tenant). Quem o
// usar como âmbito serve-lhe os dados de todas as clínicas com o banner a dizer
// que ele está numa.
//
// test/routeScoping.test.ts falha o build se alguma rota voltar a fazê-lo.
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
// Com todos os campos opcionais, `withRoute({}, handler)` compila — uma rota
// sem verificação nenhuma, indistinguível das outras à vista. Escrita como
// união discriminada, cada rota TEM de dizer em qual dos quatro mundos vive, e
// não há um quinto:
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
  | {
      permission: string;
      tenant?: TenantPolicy;
      platform?: never;
      authOnly?: never;
      public?: never;
      crossOrigin?: never;
    }
  | {
      platform: string | true;
      tenant?: TenantPolicy;
      permission?: never;
      authOnly?: never;
      public?: never;
      crossOrigin?: never;
    }
  | {
      authOnly: string;
      tenant?: TenantPolicy;
      permission?: never;
      platform?: never;
      public?: never;
      crossOrigin?: never;
    }
  | {
      public: true;
      // ─── A única forma de dispensar o same-origin/CSRF ──────────────────
      // Três rotas só funcionam assim: a captação de leads (um formulário alojado
      // noutro site), os webhooks de canal (o fornecedor de SMS/voz a chamar-nos) e
      // o portal do doente (autenticado pelo token que vem no URL). Nenhuma delas
      // se autentica por cookie ambiente — é isso, e não a origem do pedido, que
      // torna o par same-origin/CSRF inaplicável: não há credencial ambiente para
      // um site terceiro aproveitar. É também o que continua a fechar a porta a
      // todas as outras rotas, que dependem mesmo do cookie de sessão.
      //
      // Ter isto como campo, em vez de simplesmente não usar o wrapper, é o ponto:
      // a exceção fica declarada e encontra-se com um grep, em vez de ser uma
      // ausência que ninguém repara que existe.
      crossOrigin?: true;
      permission?: never;
      platform?: never;
      authOnly?: never;
      tenant?: never;
    };

// Handler já autenticado, autorizado e com o tenant resolvido.
type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

// ─── Teto de escrita partilhado entre instâncias ────────────────────────────
// O travão genérico de /api/* vive no proxy, que corre no runtime Edge e por isso
// conta em memória, por instância (ver a nota em lib/rateLimit.ts). Com duas instâncias
// atrás de um balanceador, o limite efetivo passa a ser N × o configurado.
//
// Isto não resolve o caso Edge — não há como, sem Redis — mas fecha a metade que
// importa mais: as ESCRITAS. Os route handlers correm no runtime Node, com pool de
// ligações, por isso podem usar o contador partilhado em Postgres de
// lib/rateLimitGlobal.ts.
//
// Só mutações, por uma questão de custo: uma ida à base de dados por LEITURA duplicaria
// o número de consultas da aplicação inteira para proteger o que já é idempotente e já
// tem um travão por instância. As escritas são as que consomem, as que gravam e as que
// disparam automatismos.
const WRITE_LIMIT = { limit: 120, windowMs: 60 * 1000 };
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Uma recusa que ninguém regista não aconteceu ───────────────────────────
// Este ficheiro é por onde passam as recusas dos 190 handlers, e até aqui devolvia
// 401/403 sem escrever uma linha em lado nenhum. Havia 14 chamadas a
// logBlockedAccess espalhadas por 7 rotas — as que alguém se lembrou de acrescentar
// — e mais nada. Quem andasse a espreitar endpoints com uma sessão válida de
// rececionista não deixava rasto nenhum, que é exatamente o caso que se quer ver.
//
// ─── O que decide não é o estado, é haver alguém identificado ───────────────
// A regra é `if (user)` no recordDenial abaixo, e não o 401/403. É deliberado, e não
// coincide com a divisão por estado que parece óbvia:
//
//   401 sem utilizador   cookie ausente, expirado ou com assinatura má. É quase
//                        sempre um separador aberto desde ontem a pedir
//                        /api/auth/me. Fica só no log do processo — chega para
//                        correlacionar picos, e mandá-lo para a tabela encheria de
//                        ruído o sítio onde o sinal devia estar.
//   401 COM utilizador   o token é válido e a sessão é que já não: conta desativada,
//                        movida de clínica, password mudada. Isto não é ruído — é
//                        alguém a apresentar credenciais que lhe foram retiradas, e
//                        é dos sinais mais interessantes que há. Fica gravado.
//   403                  há sessão viva, a pessoa está identificada, e pediu o que
//                        não lhe pertence. Fica gravado.
const DENIAL_LOG_LIMIT = { limit: 5, windowMs: 60 * 1000 };

// A frase que descreve uma sessão revogada, num sítio só: o `authorize` abaixo chega
// a ela por dois caminhos diferentes (o 401 do authOnly e o 403 de uma rota com
// `permission`) e a auditoria deve chamar-lhe o mesmo nas duas.
const SESSION_REVOKED = 'sessão já não é válida (conta desativada, movida de clínica ou password alterada)';

// ─── A chave tem de ser o PADRÃO da rota, não o caminho ─────────────────────
// Há cerca de 40 rotas com segmento dinâmico em app/api/**/[id]/. Com o caminho cru
// na chave, cada id diferente é um balde diferente — e a coalescência abaixo, que
// existe precisamente para o registo não ser amplificável, deixa de se aplicar a
// exatamente o caso que interessa: alguém a varrer ids numa rota a que não tem
// acesso. Uma rececionista em ciclo contra /api/patients/<uuid>/medical-history
// escreveria uma linha de audit_log por pedido.
//
// Normalizar é reduzir cada segmento identificador ao seu lugar. UUID, inteiro e
// token opaco cobrem tudo o que esta aplicação põe num segmento — ver os `[id]`,
// `[token]`, `[channel]` e `[offerId]` de app/api/.
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
// Um segmento longo sem separadores é um token (o do portal do doente tem 43
// caracteres em base64url). Não se testa o conteúdo, testa-se a forma.
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;

function routePattern(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (UUID_SEGMENT.test(seg) || NUMERIC_SEGMENT.test(seg) || OPAQUE_SEGMENT.test(seg)) return ':id';
      return seg;
    })
    .join('/');
}

// Nunca lança e nunca atrasa a resposta por mais do que um INSERT. Um problema a
// escrever a auditoria não pode transformar um 403 correto num 500.
async function recordDenial(request: NextRequest, user: SessionUser | null, reason: string, status: number) {
  try {
    const identity = user ? `user:${user.id}` : `ip:${getClientIp(request)}`;
    const path = new URL(request.url).pathname;
    // Coalescido de propósito. Sem isto, um cliente em ciclo escreve uma linha por
    // pedido e o registo de segurança passa a ser o alvo mais barato da aplicação —
    // uma amplificação de escrita servida por quem ataca. Cinco por minuto por
    // identidade e PADRÃO de rota chegam para ver o padrão; o que interessa é que
    // houve tentativas, não a contagem exata.
    if (!rateLimit(`denial:${identity}:${routePattern(path)}`, DENIAL_LOG_LIMIT).ok) return;

    const line = `${request.method} ${path} — ${reason} [${status}]`;
    console.warn(`[denied] ${line} ${identity}`);
    if (user) await logBlockedAccess(user, line);
  } catch (e) {
    console.error('[denied] falhou a registar a recusa:', e instanceof Error ? e.message : e);
  }
}

// ─── Resolução de clínica ───────────────────────────────────────────────────
// Delega em scopeTenant (lib/auth.ts) em vez de reimplementar a regra. É ele que
// honra o cookie `acting_tenant` — o "entrar na clínica" do super-admin, POST
// /api/tenants/enter — e uma reimplementação local que o ignorasse deixaria o
// super-admin sem acesso às clínicas em que entrou.
//
// A precedência é a de scopeTenant, e é a única segura: quem tem clínica própria
// usa sempre a sua e o `?tenantId=` é ignorado — deixá-lo escolher outra seria um
// IDOR entre clínicas.
//
// Exportada — como o `canOverride` de lib/permissions.ts, e pela mesma razão. O resto
// de withRoute precisa de uma sessão viva e de uma base de dados para correr; esta
// função é pura, e é ela que decide de que clínica fala cada um dos 190 handlers. Uma
// regra dessas testa-se, e testa-se sem infraestrutura nenhuma.
export function resolveTenantId(
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
//
// Devolve o motivo com a resposta, em vez de o deixar para quem regista deduzir a
// partir das opções da rota: `hasPermission` devolve `false` por DOIS motivos muito
// diferentes — a ação falta, ou a sessão foi revogada — e deduzir de fora escolhia
// sempre o primeiro. O mais interessante dos dois ficava registado como uma falta de
// permissão vulgar, no único sítio onde é registado.
type Denial = { response: Response; reason: string };

async function authorize(options: RouteOptions, user: SessionUser): Promise<Denial | null> {
  if (options.platform !== undefined) {
    const response = await requirePlatform(user, options.platform === true ? undefined : options.platform);
    if (!response) return null;
    const reason =
      typeof options.platform === 'string' ? `plataforma: sem a ação "${options.platform}"` : 'só super-admin';
    return { response, reason };
  }
  if (options.permission !== undefined) {
    if (await hasPermission(user, options.permission)) return null;
    // Separar os dois motivos custa zero: `liveUser` é memoizado por pedido
    // (WeakMap em lib/permissions.ts), por isso isto não é uma segunda ida à base
    // de dados — é a mesma promessa outra vez.
    const live = await revalidateSession(user);
    return { response: forbidden(), reason: live ? `sem a ação "${options.permission}"` : SESSION_REVOKED };
  }
  if (await revalidateSession(user)) return null;
  return { response: unauthorized(), reason: SESSION_REVOKED };
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
    // requireSameOrigin já é no-op em GET/HEAD/OPTIONS, por isso a única condição
    // aqui é a exceção declarada — e essa tem de ser escrita à mão, rota a rota.
    if (!options.crossOrigin) {
      const originCheck = requireSameOrigin(request);
      if (originCheck) return originCheck;
    }

    if (options.public) {
      return handler({ request, user: null as never, tenantId: '', params: (await ctx?.params) as P });
    }

    const user = getAuth(request);
    if (!user) {
      await recordDenial(request, null, 'sem sessão válida', 401);
      return unauthorized();
    }

    const blocked = await authorize(options, user);
    if (blocked) {
      await recordDenial(request, user, blocked.reason, blocked.response.status);
      return blocked.response;
    }

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
    if (tenantId instanceof Response) {
      await recordDenial(request, user, 'sem clínica resolvível para um pedido que exige uma', tenantId.status);
      return tenantId;
    }

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
