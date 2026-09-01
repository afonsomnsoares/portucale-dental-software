-- ─── HARDENING: tenant_id NOT NULL on every tenant-scoped table ──────────────
-- Every table below is meant to always belong to exactly one tenant; a NULL
-- tenant_id there is a bug (an insert path that forgot to set it), not a valid
-- state. Two tables are deliberately excluded because NULL is a real, designed
-- value for them:
--   • users.tenant_id          — NULL marks the platform super-admin (see
--     lib/auth.ts's `role === 'admin' && !user.tenantId` idiom, used across
--     ~15 routes to distinguish a super-admin from a tenant-scoped clinic admin).
--   • schema_fields.tenant_id  — NULL marks a global field definition shared by
--     every tenant (see the two partial unique indexes right below its
--     CREATE TABLE in scripts/schema.sql).
--
-- Idempotent: a fresh install already gets NOT NULL straight from
-- scripts/schema.sql, so this only has work to do on a database created
-- before this hardening pass. Safe on the current (empty) database; if ever
-- run against one with real orphan NULL-tenant rows, ALTER COLUMN SET NOT
-- NULL fails loudly on that table instead of silently leaving the bad rows in
-- place — fix the data first.
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'appointment_cancellations','appointments','consent_forms','data_retention_policies',
    'data_subject_requests','dpo_contacts','invoices','lab_orders','medical_history',
    'notifications','patient_data_consents','patients','prescriptions','privacy_notices',
    'processing_activities','recall_schedule','recalls','recovery_snapshots','role_permissions',
    'treatment_plans','treatments','uploads'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl
        AND column_name = 'tenant_id' AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
    END IF;
  END LOOP;
END $$;
