-- ─── patient_tasks: RLS + updated_at trigger ──────────────────────────────
-- Every other tenant-scoped, mutable table gets both of these (see
-- scripts/migrations/011_row_level_security.sql and
-- scripts/migrations/016_updated_at_triggers.sql) — patient_tasks
-- (018_patient_tasks.sql) was created after those ran, so it needs its own
-- migration to join both arrays instead of editing history in place.
-- Idempotent: same guarded DO $$ blocks as 011/016, safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patient_tasks' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE patient_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE patient_tasks FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON patient_tasks
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON patient_tasks;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON patient_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
