-- ─── HARDENING: consistent ON DELETE across foreign keys ─────────────────────
-- The five oldest tables (users, patients, appointments, treatments, invoices)
-- predate every other tenant/patient-scoped table and never got an ON DELETE
-- clause on their FKs, so they defaulted to RESTRICT while everything added
-- since has been deliberate about it. This migration makes the behavior
-- consistent, split three ways by what's actually safe for each relationship:
--
--   • tenant_id → tenants(id): ON DELETE CASCADE. Matches every other
--     tenant-scoped table already in the schema — closing a clinic's account
--     should remove its data, not fail with a FK error on just these five
--     tables.
--   • patient_id → patients(id) on appointments/invoices: ON DELETE SET NULL.
--     Both tables already carry a denormalized patient_name snapshot column
--     for exactly this situation (see scripts/schema.sql), and invoices in
--     particular are financial records with their own retention rules — they
--     should survive a patient being removed, not cascade away. Matches the
--     SET NULL pattern uploads.patient_id already uses.
--   • patient_id → patients(id) on treatments/patient_timeline: left as
--     RESTRICT, intentionally — not touched by this migration. There's no
--     name-snapshot column to fall back on, clinical records have their own
--     retention obligations, and patient_timeline is append-only by grant
--     already (REVOKE UPDATE, DELETE ... FROM PUBLIC in scripts/schema.sql). A
--     real "erase this patient" flow needs an anonymization routine, not a
--     cascading delete — that's future work, not this migration.
--
-- Idempotent: a fresh install already gets these ON DELETE clauses straight
-- from scripts/schema.sql, so this only touches a constraint whose current
-- ON DELETE rule doesn't already match — safe to run any number of times.
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['users', 'tenant_id', 'tenants', 'c'],
    ARRAY['patients', 'tenant_id', 'tenants', 'c'],
    ARRAY['appointments', 'tenant_id', 'tenants', 'c'],
    ARRAY['appointments', 'patient_id', 'patients', 'n'],
    ARRAY['treatments', 'tenant_id', 'tenants', 'c'],
    ARRAY['invoices', 'tenant_id', 'tenants', 'c'],
    ARRAY['invoices', 'patient_id', 'patients', 'n']
  ];
  tbl text;
  col text;
  reftbl text;
  want_deltype text;
  conname text;
  current_deltype text;
  ondelete_clause text;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    tbl := spec[1];
    col := spec[2];
    reftbl := spec[3];
    want_deltype := spec[4];

    SELECT c.conname, c.confdeltype INTO conname, current_deltype
    FROM pg_constraint c
    WHERE c.conrelid = tbl::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute WHERE attrelid = tbl::regclass AND attname = col
      )];

    IF conname IS NOT NULL AND current_deltype IS DISTINCT FROM want_deltype THEN
      ondelete_clause := CASE want_deltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE 'RESTRICT' END;
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, conname);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
        tbl, tbl || '_' || col || '_fkey', col, reftbl, ondelete_clause
      );
    END IF;
  END LOOP;
END $$;
