import { query } from './db';
import {
  computeLifecycleStage,
  isOutreachDue,
  LIFECYCLE_STAGES,
  type LifecycleStageKey,
  REACTIVATION_CONSENT_TYPE,
} from './lifecycleCalc';

const ITEMS_LIMIT = 50;

export async function computeLifecyclePipeline(tenantId: string) {
  const rows = await query(
    `SELECT p.id, p.name, p.phone, p.email, p.visit_count, p.last_visit, p.created_at,
            EXISTS (
              SELECT 1 FROM treatments t
              WHERE t.patient_id = p.id AND t.status IN ('proposed','accepted')
            ) AS has_open_treatment,
            EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id = p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
            ) AS has_future_appointment
     FROM patients p
     WHERE p.tenant_id = $1
     ORDER BY p.name`,
    [tenantId],
  );

  const now = new Date();
  const buckets = new Map<LifecycleStageKey, typeof rows>();
  for (const s of LIFECYCLE_STAGES) buckets.set(s.key, []);

  for (const row of rows) {
    const stage = computeLifecycleStage(
      {
        visitCount: Number(row.visit_count),
        lastVisit: row.last_visit,
        createdAt: row.created_at,
        hasOpenTreatment: !!row.has_open_treatment,
        hasFutureAppointment: !!row.has_future_appointment,
      },
      now,
    );
    buckets.get(stage)?.push(row);
  }

  const stages = LIFECYCLE_STAGES.map((s) => {
    const bucket = buckets.get(s.key) || [];
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      count: bucket.length,
      patients: bucket.slice(0, ITEMS_LIMIT).map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        visit_count: Number(r.visit_count),
        last_visit: r.last_visit,
        created_at: r.created_at,
      })),
    };
  });

  return { stages };
}

export async function listOpenLeads(tenantId: string) {
  return query(
    `SELECT * FROM leads WHERE tenant_id=$1 AND status='open' ORDER BY created_at DESC LIMIT ${ITEMS_LIMIT}`,
    [tenantId],
  );
}

export interface LifecycleTransition {
  patientId: string;
  name: string;
  from: LifecycleStageKey | null;
  to: LifecycleStageKey;
}

export interface ReactivationCandidate {
  patientId: string;
  name: string;
  phone: string | null;
}

// The automation half of the lifecycle engine (queueLifecycleOutreach in
// lib/jobsRunner.ts calls this): recomputes every patient's stage the same way
// computeLifecyclePipeline does, but diffs it against patient_lifecycle_state instead of
// just bucketing it for display. Two things come out of that diff:
//  - `transitions`: patients whose stage actually changed since the last run (persisted,
//    so `stage_since` reflects *when* they arrived, not just that they're currently there)
//  - `outreachCandidates`: patients currently 'inactive' who have given marketing-outreach
//    consent (patient_data_consents) and are past the reactivation cooldown — regardless
//    of whether this run is what made them inactive, since a dormant patient stays a valid
//    reactivation target for as long as they remain dormant.
// On the very first run for a tenant nothing has a stored stage yet, so every patient
// looks like a "transition" and every currently-inactive patient becomes an immediate
// outreach candidate — an intentional one-time catch-up, not a bug.
export async function computeLifecycleTransitions(tenantId: string): Promise<{
  transitions: LifecycleTransition[];
  outreachCandidates: ReactivationCandidate[];
}> {
  const rows = await query(
    `SELECT p.id, p.name, p.phone, p.visit_count, p.last_visit, p.created_at,
            EXISTS (
              SELECT 1 FROM treatments t
              WHERE t.patient_id = p.id AND t.status IN ('proposed','accepted')
            ) AS has_open_treatment,
            EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id = p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
            ) AS has_future_appointment,
            ls.stage AS stored_stage,
            ls.last_outreach_at,
            EXISTS (
              SELECT 1 FROM patient_data_consents c
              WHERE c.patient_id = p.id AND c.consent_type = $2 AND c.given = TRUE AND c.revoked_at IS NULL
            ) AS has_outreach_consent
     FROM patients p
     LEFT JOIN patient_lifecycle_state ls ON ls.patient_id = p.id AND ls.tenant_id = p.tenant_id
     WHERE p.tenant_id = $1`,
    [tenantId, REACTIVATION_CONSENT_TYPE],
  );

  const now = new Date();
  const transitions: LifecycleTransition[] = [];
  const outreachCandidates: ReactivationCandidate[] = [];

  for (const row of rows) {
    const stage = computeLifecycleStage(
      {
        visitCount: Number(row.visit_count),
        lastVisit: row.last_visit,
        createdAt: row.created_at,
        hasOpenTreatment: !!row.has_open_treatment,
        hasFutureAppointment: !!row.has_future_appointment,
      },
      now,
    );
    const storedStage = (row.stored_stage as LifecycleStageKey) || null;

    if (storedStage !== stage) {
      await query(
        `INSERT INTO patient_lifecycle_state (tenant_id, patient_id, stage, stage_since, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
         ON CONFLICT (tenant_id, patient_id)
         DO UPDATE SET stage=EXCLUDED.stage, stage_since=NOW(), updated_at=NOW()`,
        [tenantId, row.id, stage],
      );
      transitions.push({ patientId: row.id, name: row.name, from: storedStage, to: stage });
    }

    if (stage === 'inactive' && row.has_outreach_consent && isOutreachDue(row.last_outreach_at, now)) {
      outreachCandidates.push({ patientId: row.id, name: row.name, phone: row.phone });
    }
  }

  return { transitions, outreachCandidates };
}

// Called after a reactivation SMS is actually queued for a patient, so the
// cooldown in computeLifecycleTransitions starts counting from now instead of re-offering
// them again on the very next job run.
export async function markLifecycleOutreachSent(tenantId: string, patientId: string) {
  await query(
    `UPDATE patient_lifecycle_state SET last_outreach_at=NOW(), updated_at=NOW()
     WHERE tenant_id=$1 AND patient_id=$2`,
    [tenantId, patientId],
  );
}
