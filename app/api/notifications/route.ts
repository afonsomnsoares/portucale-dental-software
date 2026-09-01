import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

// Read-only view over the queue lib/jobsRunner.ts writes to and drains —
// lets the receptionist see what was actually sent (or failed) instead of it
// being an invisible background process. No POST/PUT here on purpose: this
// queue is only ever written by the jobs pipeline (reminders, risk outreach,
// lifecycle reactivation, recall outreach, waitlist offers), never directly by a user.
const STATUSES = new Set(['queued', 'sent', 'failed', 'retry']);
const KINDS = new Set([
  'appointment_reminder',
  'risk_outreach',
  'lifecycle_reactivation',
  'recall_reminder',
  'slot_offer',
  'plan_followup',
]);

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'notifications:read'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'super_admin' ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const status = searchParams.get('status');
  const kind = searchParams.get('kind');
  const patientId = searchParams.get('patientId');
  const limitRaw = Number(searchParams.get('limit') || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

  let sql = `SELECT n.*, p.name AS patient_name
             FROM notifications n
             LEFT JOIN patients p ON p.id = n.patient_id
             WHERE n.tenant_id = $1`;
  const vals: unknown[] = [tenantId];

  if (status && STATUSES.has(status)) {
    vals.push(status);
    sql += ` AND n.status = $${vals.length}`;
  }
  if (kind && KINDS.has(kind)) {
    vals.push(kind);
    sql += ` AND n.payload->>'kind' = $${vals.length}`;
  }
  if (patientId) {
    vals.push(patientId);
    sql += ` AND n.patient_id = $${vals.length}`;
  }

  vals.push(limit);
  sql += ` ORDER BY n.created_at DESC LIMIT $${vals.length}`;

  const rows = await query(sql, vals);
  return Response.json(rows);
}
