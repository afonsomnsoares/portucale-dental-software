import crypto from 'node:crypto';
import { enterTenantContext } from './db';

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  clinic?: string | null;
  tenantId?: string | null;
}

export type AuthRequest = Request & {
  cookies?: { get(name: string): { value: string } | undefined };
};

// ⚠️ Duplicado em lib/jwt-edge.ts para o Edge runtime (middleware.ts), que não
// tem `node:crypto`. Qualquer alteração aqui — ordem dos segredos, formato,
// validações — tem de ser espelhada lá. Ver o cabeçalho desse ficheiro.
function getJwtSecrets() {
  const rawSecrets = (process.env.JWT_SECRETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const single = String(process.env.JWT_SECRET || '').trim();
  const secrets = single ? [single, ...rawSecrets] : rawSecrets;
  const uniq: string[] = [];
  for (const s of secrets) {
    if (!uniq.includes(s)) uniq.push(s);
  }
  return uniq;
}

function requireJwtSecrets() {
  const secrets = getJwtSecrets();
  if (secrets.length === 0) throw new Error('JWT_SECRET is required');
  return secrets;
}

function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function signToken(payload: SessionUser) {
  const secrets = requireJwtSecrets();
  const rawTtl = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 24 * 7);
  const minTtl = process.env.NODE_ENV === 'production' ? 60 : 1;
  const ttlSeconds = Math.max(minTtl, rawTtl);
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
  };
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const bdy = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secrets[0]).update(`${hdr}.${bdy}`).digest('base64url');
  return `${hdr}.${bdy}.${sig}`;
}

export function verifyToken(token: string): SessionUser | null {
  if (!token) return null;
  try {
    const [hdr, bdy, sig] = token.split('.');
    if (!hdr || !bdy || !sig) return null;
    const secrets = requireJwtSecrets();
    let ok = false;
    for (const secret of secrets) {
      const expected = crypto.createHmac('sha256', secret).update(`${hdr}.${bdy}`).digest('base64url');
      if (timingSafeEqualStr(sig, expected)) {
        ok = true;
        break;
      }
    }
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(bdy, 'base64url').toString()) as SessionUser & {
      nbf?: number;
      exp?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (payload?.nbf && now < Number(payload.nbf)) return null;
    if (payload?.exp && now >= Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | null | undefined) {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = String(cookieHeader).split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

export function getAuth(request: AuthRequest) {
  const token =
    request?.cookies?.get?.('dent_token')?.value ||
    parseCookieHeader(request?.headers?.get?.('cookie') || '')?.dent_token;
  let user: SessionUser | null;
  if (token) {
    user = verifyToken(token);
  } else {
    // Fallback to Authorization header (useful for API scripts if needed)
    const auth = request.headers.get('authorization') || '';
    user = verifyToken(auth.replace('Bearer ', ''));
  }
  // Primes lib/db.ts's per-request tenant context for every query this route
  // handler makes from here on (see enterTenantContext) — the one place this
  // needs to happen, since every route already calls getAuth() first. Skipped
  // when there's no valid session; the two routes that query the DB before
  // authenticating (login, bootstrap) use withSystemContext explicitly instead.
  if (user) enterTenantContext(user);
  return user;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}

export function requireRoles(user: SessionUser | null | undefined, ...roles: string[]) {
  return !!user && roles.includes(user.role);
}

export function isSameOrigin(request: AuthRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: AuthRequest) {
  if (!isSameOrigin(request)) return forbidden();
  const method = String(request?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const csrfCookie =
    request?.cookies?.get?.('dent_csrf')?.value ||
    parseCookieHeader(request?.headers?.get?.('cookie') || '')?.dent_csrf;
  const csrfHeader = request?.headers?.get?.('x-csrf-token') || '';
  if (!csrfCookie || !csrfHeader || !timingSafeEqualStr(csrfCookie, csrfHeader)) return forbidden();
  return null;
}
