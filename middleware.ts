import { type NextRequest, NextResponse } from 'next/server';
import { ROLE_HOME } from '@/lib/constants';
import { verifyTokenEdge } from '@/lib/jwt-edge';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

// Prefixo explícito -> papel(éis) permitido(s), uma entrada por papel. 'admin' e
// 'super_admin' partilhavam '/dashboard/admin' (derivado do ROLE_HOME de lib/constants.ts,
// quando os dois apontavam para a mesma home) — hoje têm árvores completamente separadas
// (/dashboard/admin vs /dashboard/super-admin), por isso isto já não precisa de ser
// derivado por agrupamento do ROLE_HOME; uma lista explícita é mais simples e não pode
// voltar a juntar dois papéis no mesmo prefixo por acidente.
// Nota: '/dashboard/super-admin' não começa por '/dashboard/admin', por isso a ordem das
// entradas é indiferente — nenhuma apanha o prefixo da outra.
const DASHBOARD_ACCESS: Array<[prefix: string, roles: string[]]> = [
  ['/dashboard/admin', ['admin']],
  ['/dashboard/super-admin', ['super_admin']],
  ['/dashboard/receptionist', ['receptionist']],
  ['/dashboard/dentist', ['dentist']],
];

// Blanket API rate limiting (item 1) — a floor under every /api/* route so no
// endpoint can be hammered even if its handler forgot its own limiter.
// Specific endpoints (login) keep their own stricter limits on top of this;
// this is just the generic ceiling for everything else.
// Runs in the Edge runtime, so it can't write to Postgres (audit_log) — blocks
// are logged with console.warn, which the hosting platform captures.
// The Postgres-based general rate limiter (lib/rateLimitGlobal.ts) is for
// route handlers in the Node runtime.
const AUTHENTICATED_LIMIT = { limit: 240, windowMs: 60 * 1000 }; // ~4 req/s per signed-in user
const ANONYMOUS_LIMIT = { limit: 60, windowMs: 60 * 1000 }; // per IP — most /api routes require auth anyway

async function enforceApiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const token = request.cookies.get('dent_token')?.value;
  const user = token ? await verifyTokenEdge(token) : null;
  const identity = user ? `user:${user.id}` : `ip:${ip}`;
  const budget = user ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT;

  const rl = rateLimit(`api:${identity}`, budget);
  if (!rl.ok) {
    console.warn(`[rate-limit] blocked ${request.method} ${request.nextUrl.pathname} identity=${identity} ip=${ip}`);
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    const limited = await enforceApiRateLimit(request);
    if (limited) return limited;
  }

  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('dent_token')?.value;
    const user = token ? await verifyTokenEdge(token) : null;

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }

    // O super_admin entra na árvore do admin quando está dentro de uma clínica (cookie
    // posto por POST /api/tenants/enter). É assim que ele vê o interior de uma clínica
    // desde que as páginas espelhadas de /dashboard/super-admin/* deixaram de existir.
    // Sem clínica ativa continua barrado: sem ela as páginas não saberiam de que clínica
    // falam. O cookie é ignorado para todos os outros papéis (ver lib/auth.ts:scopeTenant).
    const actingTenant = request.cookies.get('acting_tenant')?.value;
    const superAdminInsideClinic = user.role === 'super_admin' && !!actingTenant;

    for (const [prefix, roles] of DASHBOARD_ACCESS) {
      if (prefix === '/dashboard/admin' && superAdminInsideClinic) continue;
      if (pathname.startsWith(prefix) && !roles.includes(user.role)) {
        const url = request.nextUrl.clone();
        url.pathname = (ROLE_HOME as Record<string, string>)[user.role] || '/';
        url.search = '';
        return NextResponse.redirect(url);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/api/:path*'],
};
