import { query } from './db';
import { computeLifecycleStage } from './lifecycleCalc';
import { computeNextAction } from './nextAction';
import { computeJourneyStage, JOURNEY_STAGES, type JourneyStageKey } from './patientJourneyCalc';

const ITEMS_LIMIT = 50;

// One batched query for every signal every patient's stage/next-action needs — same
// "single EXISTS-subquery pass over all patients" shape as
// lib/lifecycle.ts's computeLifecyclePipeline, to avoid N+1 queries across a whole
// tenant's patient list. missingFields (lib/missingData.ts) is deliberately left out of
// the next-action computed here: checking tenant-wide required custom fields per patient
// would mean joining schema_fields against each patient's custom_fields JSONB for every
// row in this list — full detail already lives one click away on the patient's own
// next-action card (app/api/patients/[id]/next-action/route.ts).
export async function computeJourneyPipeline(tenantId: string) {
  const rows = await query(
    `SELECT p.id, p.name, p.phone, p.email, p.visit_count, p.last_visit, p.created_at,
            EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id = p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
            ) AS has_future_appointment,
            EXISTS (
              SELECT 1 FROM treatments t WHERE t.patient_id = p.id AND t.status IN ('proposed','accepted')
            ) AS has_open_treatment,
            EXISTS (
              SELECT 1 FROM treatments t WHERE t.patient_id = p.id AND t.status = 'completed'
            ) AS has_completed_treatment,
            EXISTS (
              SELECT 1 FROM treatment_plans tp WHERE tp.patient_id = p.id AND tp.approved = FALSE
            ) AS has_open_plan,
            EXISTS (
              SELECT 1 FROM treatment_plans tp
              WHERE tp.patient_id = p.id AND tp.approved = TRUE
                AND NOT EXISTS (
                  SELECT 1 FROM treatments t WHERE t.patient_id = p.id AND t.status IN ('accepted','completed')
                )
            ) AS has_accepted_plan_no_treatment,
            EXISTS (
              SELECT 1 FROM recalls r WHERE r.patient_id = p.id AND r.active = TRUE AND r.next_due <= CURRENT_DATE
            ) AS recall_due,
            (SELECT COUNT(*)::int FROM patient_tasks pt WHERE pt.patient_id = p.id AND pt.status = 'pending') AS open_task_count,
            (SELECT MIN(created_at) FROM treatment_plans tp WHERE tp.patient_id = p.id AND tp.approved = FALSE) AS oldest_open_plan_at
     FROM patients p
     WHERE p.tenant_id = $1
     ORDER BY p.name`,
    [tenantId],
  );

  const now = new Date();
  const buckets = new Map<JourneyStageKey, typeof rows>();
  for (const s of JOURNEY_STAGES) buckets.set(s.key, []);

  for (const row of rows) {
    const stage = computeJourneyStage({
      visitCount: Number(row.visit_count),
      hasFutureAppointment: !!row.has_future_appointment,
      hasOpenTreatment: !!row.has_open_treatment,
      hasCompletedTreatment: !!row.has_completed_treatment,
      hasOpenPlan: !!row.has_open_plan,
      hasAcceptedPlanNoTreatment: !!row.has_accepted_plan_no_treatment,
      recallDue: !!row.recall_due,
    });
    buckets.get(stage)?.push(row);
  }

  const stages = JOURNEY_STAGES.map((s) => {
    const bucket = buckets.get(s.key) || [];
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      count: bucket.length,
      patients: bucket.slice(0, ITEMS_LIMIT).map((r) => {
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
        const nextAction = computeNextAction({
          missingFields: [],
          openTaskCount: Number(r.open_task_count || 0),
          hasUpcomingAppointment: !!r.has_future_appointment,
          lifecycleStage,
          oldestPendingPlanDays,
        });
        return {
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          visit_count: Number(r.visit_count),
          last_visit: r.last_visit,
          created_at: r.created_at,
          next_action: nextAction,
        };
      }),
    };
  });

  return { stages };
}
