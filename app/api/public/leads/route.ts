import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { enterTenantContext, query, queryOne, withSystemContext } from '@/lib/db';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { asEmail, sanitizeString } from '@/lib/validate';

// ─── THE ONLY UNAUTHENTICATED, CROSS-ORIGIN ROUTE IN THIS PROJECT ────────────
// Every other mutating route in app/api/* calls requireSameOrigin() (cookie session +
// CSRF double-submit) — this one deliberately does NOT, and must never gain that call.
// It exists so an external website, landing page, or third-party form builder can create
// a lead for a clinic without ever having a staff session — authenticated instead by a
// per-source bearer token (lib/permissions.ts's 'lead-sources:manage', managed at
// app/api/lead-sources/route.ts). requireSameOrigin() would reject exactly the
// cross-origin traffic this endpoint exists to accept.
//
// CORS is opened ONLY on this route (Access-Control-Allow-Origin: '*', plus the OPTIONS
// preflight handler below) — safe specifically because auth here is a bearer token, not
// an ambient cookie; opening CORS elsewhere in the app would leak session-authenticated
// responses to any origin, which is why nowhere else does this.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsJson(data: unknown, status: number) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return corsJson({ error: 'Missing bearer token' }, 401);

  // Rate limit by token AND by IP, on top of proxy.ts's blanket per-IP floor for
  // every /api/* route — a per-token cap contains a leaked token abused from many IPs;
  // a per-IP cap contains someone trying to brute-force/guess a valid token.
  const ip = getClientIp(request);
  const tokenLimit = rateLimit(`lead-capture-token:${token}`, { limit: 20, windowMs: 60 * 1000 });
  if (!tokenLimit.ok) {
    return corsJson({ error: 'Too many requests' }, 429);
  }
  const ipLimit = rateLimit(`lead-capture-ip:${ip}`, { limit: 30, windowMs: 60 * 1000 });
  if (!ipLimit.ok) {
    return corsJson({ error: 'Too many requests' }, 429);
  }

  // No session exists here — same situation as app/api/auth/login/route.ts looking up a
  // user by email before any tenant context is established — so this lookup runs under
  // withSystemContext() rather than the (nonexistent) caller's own tenant scope.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const source = await withSystemContext(() =>
    queryOne(
      `SELECT lcs.*, t.name AS tenant_name
       FROM lead_capture_sources lcs JOIN tenants t ON t.id = lcs.tenant_id
       WHERE lcs.token_hash=$1 AND lcs.active=TRUE`,
      [tokenHash],
    ),
  );
  if (!source) return corsJson({ error: 'Invalid or inactive token' }, 401);

  // Token resolved to a real tenant — from here on, run as that tenant under normal RLS
  // (not the system/super-admin bypass the lookup above needed), same as any other
  // authenticated request would once getAuth() has identified who's calling.
  enterTenantContext({ tenantId: source.tenant_id, role: 'system' });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const name = sanitizeString(body.name, 200);
  if (!name) return corsJson({ error: 'name is required' }, 400);
  const phone = body.phone ? sanitizeString(body.phone, 50) : null;
  const email = body.email ? asEmail(body.email) : null;
  if (body.email && !email) return corsJson({ error: 'Invalid email format' }, 400);
  if (!phone && !email) return corsJson({ error: 'phone or email is required' }, 400);
  const message = body.message ? sanitizeString(body.message, 2000) : null;

  // `source` (what shows up on the lead and drives app/dashboard/*/lifecycle's Leads
  // column) is always the capture source's own label — never anything the caller's JSON
  // body supplies — so a valid token can never be used to spoof an arbitrary origin.
  const [lead] = await query(
    `INSERT INTO leads (tenant_id, name, phone, email, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [source.tenant_id, name, phone, email, source.label, message],
  );

  await query(`UPDATE lead_capture_sources SET last_used_at=NOW(), lead_count=lead_count+1 WHERE id=$1`, [source.id]);

  await appendAudit(
    { name: `Lead Capture (${source.label})`, role: 'system', clinic: source.tenant_name },
    'CREATE',
    `Lead — ${name}`,
    null,
    'open',
    source.tenant_name,
  );

  return corsJson({ ok: true, leadId: lead.id }, 201);
}
