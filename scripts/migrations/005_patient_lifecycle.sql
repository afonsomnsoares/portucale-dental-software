-- ─── PATIENT LIFECYCLE: bridge leads → patients ───────────────
-- Lifecycle *stage* itself (new/in_treatment/stable/inactive) is computed on read
-- (see lib/lifecycleCalc.ts) from signals already in patients/treatments/appointments —
-- no stored stage column, so it can never drift out of sync. The one real gap in the
-- schema is that converting a lead never created/linked an actual patient row; this
-- column is what `app/api/leads/route.ts` PATCH fills in once it does.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_patient ON leads(patient_id);
