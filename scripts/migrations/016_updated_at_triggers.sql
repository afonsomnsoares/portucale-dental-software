-- ─── HARDENING: automatic updated_at on every UPDATE ─────────────────────────
-- Every table below has `updated_at TIMESTAMPTZ DEFAULT NOW()`, which only
-- covers INSERT — keeping it correct on UPDATE has been each route
-- remembering to add `updated_at=NOW()` to its own SET clause (see
-- app/api/invoices/[id]/route.ts, app/api/treatments/[id]/route.ts, etc.).
-- That's been consistent so far, but it's one omission away from a stale
-- updated_at with no error to catch it. This moves the responsibility into a
-- single BEFORE UPDATE trigger, the same generic function reused on every
-- table — no per-table PL/pgSQL to maintain.
--
-- Existing `updated_at=NOW()` in app/api/*/route.ts is now redundant (the
-- trigger overwrites NEW.updated_at regardless of what the UPDATE statement
-- set it to) but harmless — left as-is, not a cleanup pass on every route in
-- this migration.
--
-- Fires on the UPDATE side of `INSERT ... ON CONFLICT DO UPDATE` too (e.g.
-- app/api/patients/[id]/teeth/[num]/route.ts, app/api/inventory/route.ts) —
-- Postgres runs a table's normal UPDATE triggers for that branch.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER per table,
-- safe to re-run.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
  tables_with_updated_at text[] := ARRAY[
    'data_subject_requests','dpo_contacts','inventory_items','inventory_stock','invoices',
    'lab_orders','leads','medical_history','patient_lifecycle_state','prescriptions',
    'processing_activities','recalls','teeth','treatment_plans','treatments','waitlist_entries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated_at LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl
    );
  END LOOP;
END $$;
