// Builds a Request that app/api/**/route.ts handlers accept as if it came from a logged-in
// browser: a `dent_token` cookie (signed with lib/auth.ts's real signToken, so verifyToken
// accepts it) plus the dent_csrf cookie + x-csrf-token header pair that requireSameOrigin()
// checks on every non-GET mutation. Handlers are invoked directly (no server, no
// middleware.ts) — see test/integration/README for why that's fine here.
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { signToken } from '../../lib/auth.ts';

export interface TestUser {
  id: string;
  name: string;
  role: string;
  clinic?: string | null;
  tenantId?: string | null;
}

// Route handlers type their param as NextRequest, but every one of them only ever calls
// `.cookies?.get?.()` (optional chaining — falls back to parsing the raw Cookie header),
// `.headers`, `.url`, `.method`, `.json()` — all present on the Fetch API's plain Request.
// Casting here means individual tests don't need to cast at every call site.
type RouteRequest = NextRequest;

export function authedRequest(
  user: TestUser,
  opts: { method?: string; url: string; body?: unknown; headers?: Record<string, string> },
): RouteRequest {
  const token = signToken({
    id: user.id,
    name: user.name,
    role: user.role,
    clinic: user.clinic ?? null,
    tenantId: user.tenantId ?? null,
  });
  const csrf = crypto.randomUUID();
  const headers = new Headers(opts.headers);
  headers.set('cookie', `dent_token=${token}; dent_csrf=${csrf}`);
  headers.set('x-csrf-token', csrf);

  const init: RequestInit = { method: opts.method || 'GET', headers };
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`http://localhost${opts.url}`, init) as unknown as RouteRequest;
}

// For the handful of "no session at all" / "unauthenticated" assertions — no cookies, no
// CSRF. `headers` lets a caller add e.g. `Authorization: Bearer <token>` for testing a
// token-authenticated public route (app/api/public/leads) without a session.
export function anonRequest(opts: {
  method?: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): RouteRequest {
  const headers = new Headers(opts.headers);
  const init: RequestInit = { method: opts.method || 'GET', headers };
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`http://localhost${opts.url}`, init) as unknown as RouteRequest;
}
