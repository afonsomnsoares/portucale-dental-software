import { type NextRequest, NextResponse } from 'next/server';
import { ROLE_HOME } from '@/lib/constants';
import { verifyTokenEdge } from '@/lib/jwt-edge';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

// Explicit prefix -> allowed role(s), one entry per role. 'admin' and 'super_admin' used
// to share '/dashboard/admin' (derived from lib/constants.ts's ROLE_HOME, back when both
// mapped to the same home path) — they now have fully separate trees
// (/dashboard/admin vs /dashboard/platform), so this no longer needs to be derived by
// grouping ROLE_HOME entries; a flat list is both simpler and can't silently merge two
// roles onto the same prefix again.
const DASHBOARD_ACCESS: Array<[prefix: string, roles: string[]]> = [
  ['/dashboard/admin', ['admin']],
  ['/dashboard/platform', ['super_admin']],
  ['/dashboard/receptionist', ['receptionist']],
  ['/dashboard/dentist', ['dentist']],
];

// Blanket API rate limiting (item 1) — a floor under every /api/* route so no
// endpoint can be hammered even if its handler forgot its own limiter.
// Specific endpoints (login) keep their own stricter limits on top of this;
// this is just the generic ceiling for everything else.
// Runs in the Edge runtime, so it can't write to Postgres (audit_log) — blocks
// are logged with console.warn, which the hosting platform captures.
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

    for (const [prefix, roles] of DASHBOARD_ACCESS) {
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
