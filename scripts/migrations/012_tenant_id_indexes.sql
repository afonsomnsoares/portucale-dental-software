-- ─── PERFORMANCE: missing tenant_id indexes on high-traffic tables ──────────
-- These tables are filtered by tenant_id on effectively every query — either
-- directly in app code (app/api/treatments/route.ts, app/api/recalls/route.ts,
-- lib/jobsRunner.ts's per-tenant notification loop, appointments-by-date
-- lookups) or, since scripts/migrations/011_row_level_security.sql, implicitly
-- by every RLS policy's USING clause — but never had an index to support that
-- filter. Harmless on a near-empty database; increasingly a full scan as these
-- (the highest-row-count clinical tables) grow.
--
--   • appointments: composite (tenant_id, appt_date) — the actual predicate
--     used everywhere appointments are looked up for a day (see
--     lib/jobsRunner.ts's `WHERE tenant_id=$1 AND appt_date=$2::date` and the
--     schedule views), not just tenant_id alone.
--   • treatments, recalls, medical_history, notifications: plain tenant_id —
--     used standalone (notifications especially: lib/jobsRunner.ts queries it
--     by tenant_id on every job run, across every tenant).
--   • leads: the existing idx_leads_open_tenant (scripts/schema.sql) is
--     partial on status='open', so it doesn't serve app/api/leads/route.ts's
--     `status='all'` listing path, which filters by tenant_id only.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS, safe to run any number of times.
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON appointments(tenant_id, appt_date);
CREATE INDEX IF NOT EXISTS idx_treatments_tenant         ON treatments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recalls_tenant             ON recalls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_medical_history_tenant     ON medical_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant       ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant                ON leads(tenant_id);
