import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { snapshotItems } from '@/lib/checklistCalc';
import { query, queryOne } from '@/lib/db';
import { badRequest, conflict, created } from '@/lib/http';
import { asDate } from '@/lib/validate';

function resolveTenantId(request: NextRequest, user: { tenantId?: string | null }, bodyTenantId: unknown) {
  if (user.tenantId) return user.tenantId;
  const qsTenantId = new URL(request.url).searchParams.get('tenantId');
  return (bodyTenantId as string) || qsTenantId || null;
}

// Both GET and POST are self-service (no 'checklists:manage' needed) — starting today's
// opening checklist and ticking it off is something anyone on shift does, not a management
// action. Only editing the *template* (app/api/checklist-templates) is gated.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const tenantId = resolveTenantId(request, user, null);
  if (!tenantId) return forbidden();

  const { searchParams } = new URL(request.url);
  const date = asDate(searchParams.get('date')) || new Date().toLocaleDateString('en-CA');
  const templateId = searchParams.get('templateId');

  const vals: unknown[] = [tenantId, date];
  // run_date is cast to text — the pg driver otherwise parses a DATE column into a JS Date
  // at local midnight, which then serializes to a UTC ISO string one day off whenever the
  // server's local offset is ahead of UTC (e.g. Europe/Lisbon in DST). Same fix already
  // used by lib/staffSchedule.ts's own start_date/end_date::text casts.
  let sql = `
    SELECT r.id, r.tenant_id, r.template_id, r.template_name, r.type, r.run_date::text AS run_date,
           r.items, r.status, r.started_by, r.completed_at, r.created_at, r.updated_at,
           u.name AS started_by_name
    FROM checklist_runs r LEFT JOIN users u ON u.id = r.started_by
    WHERE r.tenant_id=$1 AND r.run_date=$2`;
  if (templateId) {
    vals.push(templateId);
    sql += ` AND r.template_id=$${vals.length}`;
  }
  sql += ' ORDER BY r.type, r.template_name';

  const rows = await query(sql, vals);
  return Response.json(rows);
}

// Starting a run snapshots the template's items at this moment (labels + all unchecked) —
// see lib/checklistCalc.ts's snapshotItems. Editing the template afterwards never changes
// a run already in progress or completed.
export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const tenantId = resolveTenantId(request, user, body.tenantId);
  if (!tenantId) return badRequest('tenantId is required');
  if (!body.templateId) return badRequest('templateId is required');
  const runDate = asDate(body.runDate) || new Date().toLocaleDateString('en-CA');

  const template = await queryOne(`SELECT * FROM checklist_templates WHERE id=$1 AND tenant_id=$2 AND active=TRUE`, [
    body.templateId,
    tenantId,
  ]);
  if (!template) return Response.json({ error: 'Checklist template not found or inactive' }, { status: 404 });

  const existing = await queryOne(`SELECT id FROM checklist_runs WHERE template_id=$1 AND run_date=$2`, [
    template.id,
    runDate,
  ]);
  if (existing) return conflict('A run for this template and date already exists', { runId: existing.id });

  const items = snapshotItems(template.items as string[]);

  const [row] = await query(
    `INSERT INTO checklist_runs (tenant_id, template_id, template_name, type, run_date, items, started_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, tenant_id, template_id, template_name, type, run_date::text AS run_date, items, status,
               started_by, completed_at, created_at, updated_at`,
    [tenantId, template.id, template.name, template.type, runDate, JSON.stringify(items), user.id],
  );

  await appendAudit(user, 'CREATE', `Checklist run: ${template.name}`, null, runDate, user.clinic);

  return created({ ...row, started_by_name: user.name });
}
