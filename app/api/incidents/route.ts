import { appendAudit } from '@/lib/audit';
import { forbidden, scopeTenant } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, sanitizeString } from '@/lib/validate';

const CATEGORIES = ['equipment', 'patient_safety', 'complaint', 'security', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

// GET is open to any tenant member — seeing what's been reported is operational
// transparency, same reasoning as app/api/staff-schedules. Reporting one (POST) is
// self-service too; only assigning/resolving (app/api/incidents/[id]) requires
// 'incidents:manage'.
export const GET = withRoute({ permission: 'incidents:read', tenant: 'optional' }, async ({ request, user }) => {
  const tenantId = scopeTenant(user, request, new URL(request.url).searchParams.get('tenantId'));
  if (!tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const severity = searchParams.get('severity');
  const category = searchParams.get('category');

  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT i.*, r.name AS reported_by_name, a.name AS assigned_to_name
    FROM incidents i
    LEFT JOIN users r ON r.id = i.reported_by
    LEFT JOIN users a ON a.id = i.assigned_to
    WHERE i.tenant_id=$1`;
  if (status && (STATUSES as readonly string[]).includes(status)) {
    vals.push(status);
    sql += ` AND i.status=$${vals.length}`;
  }
  if (severity && (SEVERITIES as readonly string[]).includes(severity)) {
    vals.push(severity);
    sql += ` AND i.severity=$${vals.length}`;
  }
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    vals.push(category);
    sql += ` AND i.category=$${vals.length}`;
  }
  sql += ` ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.created_at DESC`;

  const rows = await query(sql, vals);
  return Response.json(rows);
});

export const POST = withRoute({ permission: 'incidents:report', tenant: 'optional' }, async ({ request, user }) => {
  const tenantId = scopeTenant(user, request);
  if (!tenantId) return forbidden();

  const body = await request.json();
  const title = sanitizeString(body.title, 200);
  if (!title) return badRequest('title is required');
  const category = body.category ? asEnum(body.category, CATEGORIES) : 'other';
  if (body.category && !category) return badRequest(`category must be one of: ${CATEGORIES.join(', ')}`);
  const severity = body.severity ? asEnum(body.severity, SEVERITIES) : 'low';
  if (body.severity && !severity) return badRequest(`severity must be one of: ${SEVERITIES.join(', ')}`);

  // reported_by is always the caller — never taken from the body — same idiom as
  // app/api/staff-time-off/route.ts's user_id.
  const [row] = await query(
    `INSERT INTO incidents (tenant_id, title, description, category, severity, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tenantId, title, sanitizeString(body.description, 2000), category || 'other', severity || 'low', user.id],
  );

  await appendAudit(user, 'CREATE', `Incident: ${title}`, null, `severity:${row.severity}`, user.clinic);

  return created({ ...row, reported_by_name: user.name, assigned_to_name: null });
});
