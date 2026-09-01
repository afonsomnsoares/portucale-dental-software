-- ─── super_admin: split out of 'admin' as its own, explicit role ────────────
-- Until now "the platform super-admin" was never a real value anywhere — it
-- was inferred everywhere as `role = 'admin' AND tenant_id IS NULL`, repeated
-- across ~20 route files (see lib/db.ts, lib/permissions.ts,
-- app/api/tenants/route.ts, and every route that lets a caller pick an
-- arbitrary tenantId via query string). That inference is exactly the kind of
-- thing that gets copy-pasted wrong — three routes already had it wrong once,
-- fixed alongside scripts/migrations/011_row_level_security.sql. This
-- migration makes it a real, explicit value instead: 'super_admin' is now its
-- own role, distinct from 'admin' (which from here on always means a
-- tenant-scoped clinic admin — and, unlike before, a tenant can now actually
-- have more than one, created via POST /api/users by a super_admin).
--
-- Data migration: any existing row that was 'admin' with no tenant_id (the
-- only way a super-admin could exist before this) becomes 'super_admin'.
-- Every such row was created either by app/api/auth/bootstrap/route.ts or
-- scripts/seed.ts — both updated alongside this migration to insert
-- 'super_admin' directly going forward.
--
-- New integrity constraint: `(role = 'super_admin') = (tenant_id IS NULL)` —
-- stronger than what existed before (tenant_id being nullable was previously
-- unconstrained for its own sake; nothing stopped a 'dentist' or
-- 'receptionist' row from having a NULL tenant_id by mistake). Now the two
-- columns are tied together by construction: super_admin if and only if no
-- tenant.
--
-- Idempotent: constraint swap only runs if the current definition doesn't
-- already include 'super_admin'; the UPDATE and the consistency CHECK are
-- naturally safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'
      AND pg_get_constraintdef(oid) LIKE '%super_admin%'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin','admin','receptionist','dentist'));
  END IF;
END $$;

UPDATE users SET role = 'super_admin' WHERE role = 'admin' AND tenant_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_role_tenant_consistency'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_tenant_consistency
      CHECK ((role = 'super_admin') = (tenant_id IS NULL));
  END IF;
END $$;
