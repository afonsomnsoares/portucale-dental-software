import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { sanitizeString } from '@/lib/validate';

// Manage lead_capture_sources — each row is a revocable, per-channel token that lets
// app/api/public/leads/route.ts (unauthenticated) create a lead for this tenant. See
// scripts/migrations/023_lead_capture_sources.sql and app/api/public/leads/route.ts for
// the full security model; this file only ever handles the authenticated staff side.

// Same convention as app/api/schema/route.ts: a tenant-scoped admin always acts on their
// own tenant; a super_admin (no tenantId of their own) must say which one via
// ?tenantId=/body.tenantId, same as every other admin-config route in this project.
function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'lead-sources:manage'))) return forbidden();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  // token_hash is deliberately never selected — the plaintext token is shown exactly
  // once, at creation (see POST below), and there is no way to recover it after that.
  const rows = await query(
    `SELECT id, tenant_id, label, token_prefix, active, created_by, created_at, updated_at, last_used_at, lead_count
     FROM lead_capture_sources WHERE tenant_id=$1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'lead-sources:manage'))) return forbidden();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');
  const label = sanitizeString(body.label, 100);
  if (!label) return badRequest('label is required');

  // 192 bits of entropy, base64url so it's copy-paste/URL-safe with no padding characters
  // to worry about. 'lc_' prefix makes a leaked token grep-able/recognizable in logs, the
  // same idea as Stripe's sk_/pk_ prefixes.
  const token = `lc_${crypto.randomBytes(24).toString('base64url')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenPrefix = token.slice(0, 14);

  const [row] = await query(
    `INSERT INTO lead_capture_sources (tenant_id, label, token_hash, token_prefix, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, tenant_id, label, token_prefix, active, created_by, created_at, updated_at, last_used_at, lead_count`,
    [tenantId, label, tokenHash, tokenPrefix, user.id],
  );

  await appendAudit(user, 'CREATE', `Lead capture source: ${label}`, null, 'active', user.clinic);

  // The only response, ever, that carries the plaintext token.
  return created({ ...row, token });
}
