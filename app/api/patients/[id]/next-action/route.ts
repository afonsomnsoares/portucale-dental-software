import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { computeLifecycleStage } from '@/lib/lifecycleCalc';
import { findMissingFields, type RequiredSchemaField } from '@/lib/missingData';
import { computeNextAction } from '@/lib/nextAction';
import { revalidateSession } from '@/lib/permissions';

// Mirrors app/api/patients/[id]/timeline/route.ts: a sibling read-only
// resource on a single patient, not folded into GET /api/patients/[id]
// itself so that route stays cheap for list/search use.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  // A sessão pode ter sido desativada, despromovida ou movida de clínica depois de o
  // token ser assinado; revalidateSession() confirma-o contra `users` e realinha
  // user.role/user.tenantId. Ver lib/permissions.ts.
  if (!(await revalidateSession(user))) return unauthorized();
  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;

  const patient = await queryOne(
    `SELECT id, tenant_id, phone, email, dob, custom_fields, visit_count, last_visit, created_at
     FROM patients WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
    [id, tenantId],
  );
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });

  // Tenant-specific fields take priority; only fall back to the global set when the
  // tenant has none of its own — same precedence as app/api/patients/route.ts and
  // app/api/patients/[id]/route.ts. A plain "tenant OR global" union would double-count
  // a field_name that exists in both (e.g. a global default a tenant has overridden).
  let schemaFields = await query(`SELECT field_name, label, required, rollout FROM schema_fields WHERE tenant_id=$1`, [
    patient.tenant_id,
  ]);
  if (!schemaFields.length) {
    schemaFields = await query(
      `SELECT field_name, label, required, rollout FROM schema_fields WHERE tenant_id IS NULL`,
    );
  }

  const [openTasks, futureAppt, openTreatment, oldestPendingPlan] = await Promise.all([
    queryOne(`SELECT COUNT(*)::int AS n FROM patient_tasks WHERE patient_id=$1 AND status='pending'`, [id]),
    queryOne(
      `SELECT 1 FROM appointments WHERE patient_id=$1 AND appt_date >= CURRENT_DATE AND status <> 'no-show' LIMIT 1`,
      [id],
    ),
    queryOne(`SELECT 1 FROM treatments WHERE patient_id=$1 AND status IN ('proposed','accepted') LIMIT 1`, [id]),
    queryOne(
      `SELECT created_at FROM treatment_plans WHERE patient_id=$1 AND approved=FALSE ORDER BY created_at ASC LIMIT 1`,
      [id],
    ),
  ]);

  const missingFields = findMissingFields(
    { phone: patient.phone, email: patient.email, dob: patient.dob, custom_fields: patient.custom_fields },
    schemaFields as unknown as RequiredSchemaField[],
  );
  const lifecycleStage = computeLifecycleStage({
    visitCount: Number(patient.visit_count),
    lastVisit: patient.last_visit,
    createdAt: patient.created_at,
    hasOpenTreatment: !!openTreatment,
    hasFutureAppointment: !!futureAppt,
  });
  const oldestPendingPlanDays = oldestPendingPlan
    ? Math.floor((Date.now() - new Date(oldestPendingPlan.created_at).getTime()) / 86400000)
    : null;

  const nextAction = computeNextAction({
    missingFields,
    openTaskCount: Number(openTasks?.n || 0),
    hasUpcomingAppointment: !!futureAppt,
    lifecycleStage,
    oldestPendingPlanDays,
  });

  return Response.json({ missingFields, nextAction, lifecycleStage });
}
