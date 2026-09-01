import { query } from './db';
import { computeLifecycleStage } from './lifecycleCalc';
import { findMissingFields, type MissingField, type RequiredSchemaField } from './missingData';
import { computeNextAction, type NextAction } from './nextAction';

// "Operação do dentista" (item 10): reduce the administrative overhead around a day of
// appointments without touching anything clinical — for each patient on today's
// schedule, surface exactly the same signals already proven out in the Patient Journey
// board (lib/patientJourney.ts) and the per-patient next-action card
// (app/api/patients/[id]/next-action/route.ts), just re-scoped from "every patient in
// the clinic" to "who's actually coming in today". One batched query (same shape as
// computeJourneyPipeline) so this stays cheap even on a busy day.

export interface DailyBriefingRow {
  appointmentId: string;
  appointmentStatus: string;
  startTime: string;
  patientId: string;
  patientName: string;
  missingFields: MissingField[];
  openTaskCount: number;
  hasUpcomingAppointment: boolean;
  nextAction: NextAction;
}

export async function computeDailyBriefing(
  tenantId: string,
  date: string,
  dentistId?: string | null,
): Promise<DailyBriefingRow[]> {
  const vals: unknown[] = [tenantId, date];
  let dentistFilter = '';
  if (dentistId) {
    vals.push(dentistId);
    dentistFilter = ` AND a.dentist_id=$${vals.length}`;
  }

  const rows = await query(
    `SELECT a.id AS appointment_id, a.status AS appointment_status, a.start_time,
            p.id AS patient_id, p.name AS patient_name, p.phone, p.email, p.dob, p.custom_fields,
            p.visit_count, p.last_visit, p.created_at,
            EXISTS (
              SELECT 1 FROM appointments a2
              WHERE a2.patient_id = p.id AND a2.appt_date > $2::date AND a2.status <> 'no-show'
            ) AS has_future_appointment,
            EXISTS (
              SELECT 1 FROM treatments t WHERE t.patient_id = p.id AND t.status IN ('proposed','accepted')
            ) AS has_open_treatment,
            (SELECT COUNT(*)::int FROM patient_tasks pt WHERE pt.patient_id = p.id AND pt.status = 'pending') AS open_task_count,
            (SELECT MIN(created_at) FROM treatment_plans tp WHERE tp.patient_id = p.id AND tp.approved = FALSE) AS oldest_open_plan_at
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.tenant_id=$1 AND a.appt_date=$2::date${dentistFilter}
     ORDER BY a.start_time`,
    vals,
  );
  if (!rows.length) return [];

  // Same tenant-then-global fallback precedence as app/api/patients/[id]/next-action —
  // never both at once, see that route's comment for why.
  let schemaFields = await query(`SELECT field_name, label, required, rollout FROM schema_fields WHERE tenant_id=$1`, [
    tenantId,
  ]);
  if (!schemaFields.length) {
    schemaFields = await query(
      `SELECT field_name, label, required, rollout FROM schema_fields WHERE tenant_id IS NULL`,
    );
  }

  const now = new Date();
  return rows.map((r) => {
    const missingFields = findMissingFields(
      { phone: r.phone, email: r.email, dob: r.dob, custom_fields: r.custom_fields },
      schemaFields as unknown as RequiredSchemaField[],
    );
    const lifecycleStage = computeLifecycleStage(
      {
        visitCount: Number(r.visit_count),
        lastVisit: r.last_visit,
        createdAt: r.created_at,
        hasOpenTreatment: !!r.has_open_treatment,
        hasFutureAppointment: !!r.has_future_appointment,
      },
      now,
    );
    const oldestPendingPlanDays = r.oldest_open_plan_at
      ? Math.floor((now.getTime() - new Date(r.oldest_open_plan_at).getTime()) / 86400000)
      : null;
    const openTaskCount = Number(r.open_task_count || 0);
    const nextAction = computeNextAction({
      missingFields,
      openTaskCount,
      hasUpcomingAppointment: !!r.has_future_appointment,
      lifecycleStage,
      oldestPendingPlanDays,
    });

    return {
      appointmentId: r.appointment_id,
      appointmentStatus: r.appointment_status,
      startTime: r.start_time,
      patientId: r.patient_id,
      patientName: r.patient_name,
      missingFields,
      openTaskCount,
      hasUpcomingAppointment: !!r.has_future_appointment,
      nextAction,
    };
  });
}
