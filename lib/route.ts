import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, type SessionUser, unauthorized } from './auth';
import { hasPermission } from './permissions';

// Política de tenant da rota. Os três casos que existem hoje em app/api/*:
//   'required' — a rota precisa de uma clínica concreta (33 rotas).
//   'optional' — o super-admin lê sem clínica (tenantId null = todas).
//   'resolved' — o super-admin escolhe a clínica por ?tenantId= ou no body
//                (substitui os 13 `resolveTenantId` locais copiados entre rotas).
type TenantPolicy = 'required' | 'optional' | 'resolved';

export interface RouteContext<P> {
  request: NextRequest;
  user: SessionUser;
  // Já resolvido segundo a política. Com 'required' é sempre string — o handler
  // não precisa de o voltar a verificar, e o tipo garante isso.
  tenantId: string;
  params: P;
}

interface RouteOptions {
  permission?: string;
  tenant?: TenantPolicy;
  // Rotas públicas (login, /api/public/*) declaram-no explicitamente. É a única
  // forma de saltar a autenticação, por isso "esquecer-se" deixa de ser possível:
  // o default é fechado, e abrir exige escrever a palavra.
  public?: true;
}

// Handler já autenticado, autorizado e com o tenant resolvido.
type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

async function resolveTenantId(
  request: NextRequest,
  user: SessionUser,
  policy: TenantPolicy,
  body: unknown,
): Promise<string | null | Response> {
  if (user.tenantId) return user.tenantId;
  if (policy === 'required') return forbidden();
  if (policy === 'optional') return null;
  const fromBody = (body as { tenantId?: unknown } | null)?.tenantId;
  const fromQuery = new URL(request.url).searchParams.get('tenantId');
  return (typeof fromBody === 'string' && fromBody) || fromQuery || null;
}

/**
 * Envolve um handler de rota com o preâmbulo que hoje está copiado em 92
 * ficheiros: CSRF/same-origin, autenticação, permissão e resolução de tenant.
 *
 * O ponto não é poupar linhas — é que a omissão deixa de ser silenciosa. Hoje
 * uma rota sem `hasPermission` compila, passa nos testes e parece igual às
 * outras; a única defesa é alguém reparar na revisão. Com isto, uma rota sem
 * `permission` nem `public` nem sequer é aceite pelo TypeScript.
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

    if (options.permission && !(await hasPermission(user, options.permission))) return forbidden();

    // O body é lido uma só vez e passado adiante: Request.json() só pode ser
    // consumido uma vez, e a política 'resolved' precisa de espreitar lá dentro.
    let body: unknown = null;
    const needsBody = options.tenant === 'resolved' && request.method !== 'GET';
    if (needsBody) body = await request.json().catch(() => null);

    const tenantId = await resolveTenantId(request, user, options.tenant ?? 'required', body);
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
