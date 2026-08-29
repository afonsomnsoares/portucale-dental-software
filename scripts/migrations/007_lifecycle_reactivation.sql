-- ─── PATIENT LIFECYCLE: transition tracking + reactivation outreach ──────────
-- computeLifecycleStage() in lib/lifecycleCalc.ts stays a pure, on-read computation
-- (no stage column on `patients` — see the comment at the top of that file for why).
-- This table is deliberately separate: it only remembers the *last stage we saw* per
-- patient plus when we last reached out, so the job runner can tell "just became
-- inactive" apart from "has been inactive for months and we already messaged them" —
-- something a stateless computation can never answer on its own.
CREATE TABLE IF NOT EXISTS patient_lifecycle_state (
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  stage            TEXT NOT NULL,
  stage_since      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_outreach_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_state_stage
  ON patient_lifecycle_state(tenant_id, stage);
