import crypto from 'node:crypto';
import { appendAudit } from '@/lib/audit';
import { query, queryRead } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { sanitizeString } from '@/lib/validate';

// Manage lead_capture_sources — each row is a revocable, per-channel token that lets
// app/api/public/leads/route.ts (unauthenticated) create a lead for this tenant. See
// scripts/migrations/023_lead_capture_sources.sql and app/api/public/leads/route.ts for
// the full security model; this file only ever handles the authenticated staff side.

export const GET = withRoute({ permission: 'lead-sources:manage', tenant: 'resolved' }, async ({ tenantId }) => {
  // token_hash is deliberately never selected — the plaintext token is shown exactly
  // once, at creation (see POST below), and there is no way to recover it after that.
  const rows = await queryRead(
    `SELECT id, tenant_id, label, token_prefix, active, created_by, created_at, updated_at, last_used_at, lead_count
     FROM lead_capture_sources WHERE tenant_id=$1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return Response.json(rows);
});

export const POST = withRoute(
  { permission: 'lead-sources:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
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
  },
);
