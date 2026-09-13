import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { enterTenantContext } from './db';

// Dummy hash para mitigação de timing no login.
// O bcrypt.compare com este hash demora exatamente o mesmo que comparar
// com um hash real (custo 10), eliminando o oráculo de "email existe vs
// email não existe". Gerado a partir de uma string que nunca é uma
// password válida de registo, por isso nunca corresponde a um utilizador.
// O valor é calculado uma única vez em runtime e cacheado no módulo.
let _dummyPasswordHash: string | undefined;
export function getDummyPasswordHash(): string {
  if (!_dummyPasswordHash) _dummyPasswordHash = bcrypt.hashSync('dummy-for-timing-attack-mitigation', 10);
  return _dummyPasswordHash;
}

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  clinic?: string | null;
  tenantId?: string | null;
  // Momento de emissão do token (segundos Unix), escrito por signToken e devolvido
  // tal e qual por verifyToken. Declarado aqui porque deixou de ser detalhe interno
  // do formato: lib/permissions.ts's revalidateSession compara-o com
  // `users.password_changed_at` para recusar tokens anteriores à última mudança de
  // password. Opcional porque signToken o preenche sempre — quem constrói um
  // SessionUser para assinar não o fornece (e se o fornecer, é sobreposto).
  iat?: number;
}

export type AuthRequest = Request & {
  cookies?: { get(name: string): { value: string } | undefined };
};

// ⚠️ Duplicado em lib/jwt-edge.ts para o Edge runtime (proxy.ts), que não
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
    // intentional — returns null on invalid token
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

// ─── Clínica ativa do super_admin ────────────────────────────────────────────
// O super_admin não tem clínica própria (users_role_tenant_consistency), por isso, para
// ver o interior de uma, "entra" nela: POST /api/tenants/enter grava este cookie e a
// partir daí ele usa as páginas do próprio admin. Substitui as 12 páginas espelhadas em
// components/super-admin/pages/, cada uma com o seu seletor de clínica em estado local —
// que se perdia a cada navegação.
export const ACTING_TENANT_COOKIE = 'acting_tenant';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rawCookie(request: AuthRequest, name: string): string | null {
  return (
    request?.cookies?.get?.(name)?.value || parseCookieHeader(request?.headers?.get?.('cookie') || '')?.[name] || null
  );
}

// O valor do cookie, se for um UUID. Não é assinado de propósito: só é lido para quem já
// é super_admin (ver scopeTenant), e um super_admin pode entrar em qualquer clínica de
// qualquer forma — não há privilégio a ganhar por o forjar. Para todos os outros papéis é
// pura e simplesmente ignorado.
export function actingTenantId(request: AuthRequest): string | null {
  const raw = rawCookie(request, ACTING_TENANT_COOKIE);
  return raw && UUID_RE.test(raw) ? raw : null;
}

// A clínica a que este pedido diz respeito. Substitui as ~31 repetições de
// `user.role === 'super_admin' ? null : user.tenantId` espalhadas por app/api/ — a
// inferência que a migração 017 dizia estar a eliminar e que só mudou de escrita.
//
//   • utilizador com clínica  → sempre a sua, e o `requested` é ignorado (era assim antes:
//                               deixá-lo escolher outra seria um IDOR entre clínicas);
//   • super_admin dentro de uma clínica → essa;
//   • super_admin fora        → `requested` (o ?tenantId= das páginas de plataforma) ou
//                               null, que nas queries significa "todas as clínicas".
export function scopeTenant(
  user: SessionUser | null | undefined,
  request: AuthRequest,
  requested?: string | null,
): string | null {
  if (!user) return null;
  if (user.tenantId) return user.tenantId;
  if (user.role !== 'super_admin') return null;
  return actingTenantId(request) || requested || null;
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
  // O contexto de RLS acompanha a clínica em que o super_admin entrou: as políticas
  // passam a filtrar por ela em vez de verem tudo. Continua com isSuperAdmin=true (é o
  // role que o decide), por isso nenhuma política o barra — é defesa em profundidade,
  // não a única barreira.
  if (user) {
    const acting = user.role === 'super_admin' ? actingTenantId(request) : null;
    enterTenantContext(acting ? { ...user, tenantId: acting } : user);
  }
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

function isSameOrigin(request: AuthRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    // intentional — returns false on malformed origin
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
