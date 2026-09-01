-- ─── HARDENING: real hash-chain tamper-evidence for audit_log / patient_timeline ─
-- lib/audit.ts's hashEntry() only ever hashed the entry itself, with no link to
-- what came before it — good for catching accidental corruption of a single
-- field, but not real tamper-evidence: a row disappearing or being overwritten
-- would not show up anywhere (both tables already REVOKE UPDATE, DELETE from
-- PUBLIC/portucale_app — see scripts/schema.sql — but the table owner/a
-- superuser bypasses that, same as it bypasses RLS).
--
-- This moves hash computation into a BEFORE INSERT trigger that chains each
-- row to the one before it: hash = sha256(prev_hash || this row's fields).
-- Altering or deleting a row breaks the chain from that point forward,
-- detectably. Computed server-side, in the trigger, unconditionally
-- overwriting whatever the client sent (lib/audit.ts and
-- app/api/patients/import/route.ts stop computing a hash themselves in the
-- same change that adds this migration) — a client-supplied hash is worthless
-- for tamper-evidence, since a tamperer could just compute a fake chain that
-- verifies against itself.
--
-- pg_advisory_xact_lock serializes concurrent inserts into the same table for
-- the duration of the transaction, so two simultaneous writers can't both read
-- the same "previous hash" and fork the chain — the second waits for the
-- first to commit (or roll back) before computing its own hash. Cheap in
-- practice: audit writes are not a hot path.
--
-- Both triggers are un-RLS'd table triggers (audit_log/patient_timeline are
-- the two tables scripts/migrations/011_row_level_security.sql explicitly
-- leaves uncovered — see its trailing comment) — the chain is single, global,
-- insertion-order per table, not scoped per tenant.
--
-- Verify the chain at any time with, e.g.:
--   SELECT id FROM audit_log a WHERE hash <> encode(digest(
--     COALESCE((SELECT hash FROM audit_log WHERE id < a.id ORDER BY id DESC LIMIT 1), '') ||
--     a.user_name || a.user_role || a.clinic || a.action || a.resource ||
--     COALESCE(a.before_val,'') || COALESCE(a.after_val,''), 'sha256'), 'hex');
-- (empty result = chain intact). Rows inserted before this migration keep
-- their old, non-chained hash — the chain is trustworthy from here forward,
-- not retroactively.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER, safe to
-- re-run.
CREATE OR REPLACE FUNCTION chain_audit_log_hash() RETURNS trigger AS $$
DECLARE
  prev_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
  SELECT hash INTO prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(
    digest(
      COALESCE(prev_hash, '') || NEW.user_name || NEW.user_role || NEW.clinic || NEW.action || NEW.resource ||
        COALESCE(NEW.before_val, '') || COALESCE(NEW.after_val, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chain_audit_log_hash ON audit_log;
CREATE TRIGGER trg_chain_audit_log_hash
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION chain_audit_log_hash();

CREATE OR REPLACE FUNCTION chain_patient_timeline_hash() RETURNS trigger AS $$
DECLARE
  prev_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('patient_timeline_chain'));
  SELECT hash INTO prev_hash FROM patient_timeline ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(
    digest(
      COALESCE(prev_hash, '') || COALESCE(NEW.patient_id::text, '') || NEW.user_name || NEW.user_role ||
        NEW.event_type || NEW.event,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chain_patient_timeline_hash ON patient_timeline;
CREATE TRIGGER trg_chain_patient_timeline_hash
  BEFORE INSERT ON patient_timeline
  FOR EACH ROW EXECUTE FUNCTION chain_patient_timeline_hash();
