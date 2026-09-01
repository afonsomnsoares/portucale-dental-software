-- ─── HARDENING: CHECK constraints on status columns ──────────────────────────
-- These 7 tables' status columns were plain TEXT with no constraint — nothing
-- at the DB level stopped an invalid state. Enums below are taken directly
-- from what the app actually reads/writes today (routes + the appointment
-- status-transition graph in the `statuses` table), not invented:
--
--   appointments — full transition graph (app/api/appointments/[id]/status/route.ts)
--   patients     — mirrored from appointment status changes, plus the 'registered' default
--   invoices     — allow-list already enforced in app/api/invoices/[id]/route.ts
--   treatments   — values used at insert + UI filters; no DB or app-level
--                  enforcement existed before this migration (now added in
--                  app/api/treatments/[id]/route.ts too)
--   prescriptions, lab_orders, notifications — same: values used in code, no
--                  enforcement existed
--
-- Deliberately NOT touched: tenants.status and job_runs.status (internal /
-- platform, outside this pass's scope) and treatment_plans.status (dead
-- column — grep confirms no route reads or writes it; the plan lifecycle runs
-- entirely on the `approved` boolean instead, so there's no real enum to
-- encode yet).
--
-- Idempotent: a fresh install already gets these CHECKs straight from
-- scripts/schema.sql (as unnamed inline constraints, which Postgres names
-- exactly `<table>_status_check` by convention — the same names used here),
-- so this only adds a constraint that isn't already present.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
      CHECK (status IN ('confirmed','waiting','in-operatory','procedure-active','ready-dismissal','departed','no-show'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_status_check') THEN
    ALTER TABLE patients ADD CONSTRAINT patients_status_check
      CHECK (status IN ('registered','waiting','in-operatory','ready-dismissal','departed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_check') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('pending','partial','paid','cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatments_status_check') THEN
    ALTER TABLE treatments ADD CONSTRAINT treatments_status_check
      CHECK (status IN ('proposed','accepted','completed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prescriptions_status_check') THEN
    ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_status_check
      CHECK (status IN ('active','cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_orders_status_check') THEN
    ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_status_check
      CHECK (status IN ('ordered','sent','in-progress','received'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_status_check') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
      CHECK (status IN ('queued','sent','failed','retry'));
  END IF;
END $$;
