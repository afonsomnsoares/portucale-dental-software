-- ─── HARDENING: Row-Level Security as a DB-level backstop for tenant isolation ─
-- Today, tenant isolation is enforced only in application code (the
-- `role === 'admin' && !user.tenantId` idiom repeated across ~15 route files,
-- plus lib/tenantGuard.ts for patient-ownership checks). A single route that
-- gets that check wrong — three already do, see app/api/invoices/route.ts,
-- app/api/finance/stats/route.ts, app/api/permissions/route.ts (fixed
-- alongside this migration) — leaks another tenant's data. This migration adds
-- a second, independent layer: Postgres itself refuses to return or touch a
-- row outside the calling session's tenant, regardless of what SQL the
-- application sends.
--
-- IMPORTANT: this only does something once the app stops connecting as the
-- `postgres` superuser — superusers unconditionally bypass RLS, FORCE or not.
-- lib/db.ts, lib/auth.ts, scripts/run-jobs.ts, .env and docker-compose.yml
-- were updated alongside this migration to make `portucale_app` (created
-- below) the connection the actual Next.js app uses; scripts/migrate.ts,
-- scripts/seed.ts and the background jobs runner keep using the existing
-- admin connection, since they legitimately need cross-tenant/DDL access.
--
-- Session context is two Postgres GUCs, set per-query by lib/db.ts from the
-- authenticated request (see enterTenantContext in lib/db.ts):
--   app.tenant_id      — the caller's tenant UUID, or the sentinel below if
--                        no session context was ever established (fail-closed:
--                        matches no real tenant, so the query just sees zero
--                        rows instead of erroring or leaking).
--   app.is_super_admin — 'true' for the platform super-admin (role=admin with
--                        no tenantId), who bypasses tenant scoping entirely,
--                        matching existing application behavior.
--
-- Idempotent: a fresh install already gets most of this straight from the
-- tail of scripts/schema.sql (everything except the six tables only
-- migrations 001-007 create) — every step here checks pg_roles/pg_policies
-- first, so re-running against a database that has either is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portucale_app') THEN
    CREATE ROLE portucale_app LOGIN;
  END IF;
END $$;

-- Password is set separately (ALTER ROLE ... PASSWORD ...) at apply time —
-- deliberately never committed to this file. Least-privilege grants only:
-- no DDL, no TRUNCATE, no role membership.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO portucale_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO portucale_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO portucale_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO portucale_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO portucale_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO portucale_app;

-- audit_log and patient_timeline are append-only by design (already
-- `REVOKE UPDATE, DELETE ... FROM PUBLIC` in scripts/schema.sql) — the blanket
-- grant above would otherwise hand that back to portucale_app, so claw it back
-- explicitly for this role too.
REVOKE UPDATE, DELETE ON audit_log, patient_timeline FROM portucale_app;

-- ─── Generic tenant-isolation policy for every table with a tenant_id column ──
-- (except schema_fields and users' extra NULL-tenant case, and tenants itself,
-- all handled separately below).
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'appointment_cancellations','appointments','consent_forms','data_retention_policies',
    'data_subject_requests','dpo_contacts','inventory_stock','invoices','lab_orders','leads',
    'medical_history','notifications','patient_data_consents','patient_lifecycle_state','patients',
    'prescriptions','privacy_notices','processing_activities','recall_schedule','recalls',
    'recovery_snapshots','role_permissions','slot_offers','treatment_plans','treatments',
    'uploads','users'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        $f$CREATE POLICY tenant_isolation ON %I
             USING (current_setting('app.is_super_admin', true) = 'true'
                    OR tenant_id = current_setting('app.tenant_id', true)::uuid)
             WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                         OR tenant_id = current_setting('app.tenant_id', true)::uuid)$f$,
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ─── schema_fields: tenant_id NULL means "global field", visible to everyone ──
ALTER TABLE schema_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_fields FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'schema_fields' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON schema_fields
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id IS NULL
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id IS NULL
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── tenants: keyed on id, not tenant_id — a tenant-scoped session only ever
-- sees its own clinic's row; the super-admin sees all of them ────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON tenants
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Not covered (documented, not an oversight) — five tables, none of which has a
-- tenant_id column to key a policy on:
--   patient_timeline    keys off patient_id only; append-only audit trail.
--   audit_log           keys off a legacy `clinic` text field predating the UUID
--                       tenant model; append-only.
--   patient_alerts      keys off patient_id only, and is only ever reached by
--                       joining through `patients`, which IS under a policy — so
--                       the join scopes it even though the table itself doesn't.
--   rate_limit_counters holds no tenant data at all: keys and counters.
--   inventory_items     deliberately global — the shared catalogue every clinic
--                       draws from. Per-clinic overrides live in
--                       inventory_item_settings, which IS under a policy
--                       (migration 044).
-- Retrofitting tenant_id onto the first two is a separate, bigger migration; the
-- last three don't want one. These stay at app-level trust, same as today.
--
-- `teeth` used to be named here too. It was dropped by migration 034 along with
-- the odontogram, so it is no longer a table this file has anything to say about.
