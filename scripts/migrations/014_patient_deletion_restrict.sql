-- ─── HARDENING: uniform "block, don't cascade" patient deletion policy ───────
-- Today, deleting a patient behaves two different ways depending on which
-- clinical table you look at:
--   • treatments, patient_timeline           — RESTRICT (blocks the delete)
--   • medical_history, prescriptions,
--     lab_orders, consent_forms,
--     treatment_plans, recalls               — CASCADE (silently destroyed)
--
-- That split was accidental (CASCADE was just the default choice made when
-- each of these six tables was added), not a deliberate policy — and for a
-- healthcare app already modeling RGPD retention (data_retention_policies,
-- data_subject_requests), "physically delete a patient's clinical record the
-- instant someone deletes the patient row" is the wrong default. This
-- migration makes the six CASCADE tables match treatments/patient_timeline's
-- existing RESTRICT behavior instead: a patient with any clinical history
-- can no longer be hard-deleted at all. An actual "right to erasure" request
-- needs an anonymization routine (scrub PII, keep the clinical record) — that
-- routine is future work, not this migration; this just stops the silent
-- data loss in the meantime.
--
-- Deliberately not touched here: patient_alerts, teeth, patient_data_consents,
-- data_subject_requests, appointments, invoices, uploads — a separate pass,
-- since appointments/invoices/uploads already use SET NULL with a snapshot
-- column (a different, already-considered tradeoff) and the rest need their
-- own look before changing.
--
-- Matches treatments' own FK exactly: no ON DELETE clause at all (implicit
-- NO ACTION, the same thing scripts/migrations/009's header comment calls
-- RESTRICT), not an explicit "ON DELETE RESTRICT" — kept identical so a
-- future schema diff doesn't flag a difference that isn't one.
--
-- Idempotent: only touches a constraint that's still ON DELETE CASCADE, so a
-- second run (or a fresh install where scripts/schema.sql should be updated
-- to match — see that file) is a no-op.
DO $$
DECLARE
  tbl text;
  conname text;
  current_deltype text;
  tenant_tables text[] := ARRAY[
    'medical_history','prescriptions','lab_orders','consent_forms','treatment_plans','recalls'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    SELECT c.conname, c.confdeltype INTO conname, current_deltype
    FROM pg_constraint c
    WHERE c.conrelid = tbl::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'patients'::regclass
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute WHERE attrelid = tbl::regclass AND attname = 'patient_id'
      )];

    IF conname IS NOT NULL AND current_deltype = 'c' THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, conname);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (patient_id) REFERENCES patients(id)',
        tbl, tbl || '_patient_id_fkey'
      );
    END IF;
  END LOOP;
END $$;
