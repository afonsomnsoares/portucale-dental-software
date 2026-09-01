import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asEnum, sanitizeString } from '@/lib/validate';

const CATEGORIES = ['equipment', 'patient_safety', 'complaint', 'security', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

// The "escalation" workflow (assign to someone, change severity/status, resolve) requires
// 'incidents:manage' — unlike checklist runs, this isn't undoing your own action, it's
// managing someone else's report, so there's no self-service carve-out here.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'incidents:manage'))) return forbidden();
  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;

  const prev = await queryOne(`SELECT * FROM incidents WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    tenantId,
  ]);
  if (!prev) return notFound('Incident not found');

  const body = await request.json();
  const category = body.category !== undefined ? asEnum(body.category, CATEGORIES) : prev.category;
  if (body.category !== undefined && !category) {
    return Response.json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, { status: 400 });
  }
  const severity = body.severity !== undefined ? asEnum(body.severity, SEVERITIES) : prev.severity;
  if (body.severity !== undefined && !severity) {
    return Response.json({ error: `severity must be one of: ${SEVERITIES.join(', ')}` }, { status: 400 });
  }
  const status = body.status !== undefined ? asEnum(body.status, STATUSES) : prev.status;
  if (body.status !== undefined && !status) {
    return Response.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
  }
  const assignedTo = body.assignedTo !== undefined ? body.assignedTo || null : prev.assigned_to;
  const resolutionNotes =
    body.resolutionNotes !== undefined ? sanitizeString(body.resolutionNotes, 2000) : prev.resolution_notes;

  const resolving =
    (status === 'resolved' || status === 'closed') && prev.status !== 'resolved' && prev.status !== 'closed';
  const reopening = status !== 'resolved' && status !== 'closed';

  const [row] = await query(
    `UPDATE incidents
     SET category=$1, severity=$2, status=$3, assigned_to=$4, resolution_notes=$5,
         resolved_at=$6
     WHERE id=$7 AND ($8::uuid IS NULL OR tenant_id=$8::uuid)
     RETURNING *`,
    [
      category,
      severity,
      status,
      assignedTo,
      resolutionNotes,
      resolving ? new Date().toISOString() : reopening ? null : prev.resolved_at,
      id,
      tenantId,
    ],
  );

  await appendAudit(
    user,
    'UPDATE',
    `Incident: ${prev.title}`,
    `status:${prev.status}`,
    `status:${row.status}`,
    user.clinic,
  );

  return Response.json(row);
}
