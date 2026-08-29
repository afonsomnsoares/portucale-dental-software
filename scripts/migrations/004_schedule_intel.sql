-- ─── SCHEDULE INTELLIGENCE: cancellation log, risk timestamp, waitlist, slot offers ───

-- Cancellations are hard-deleted from `appointments` (see DELETE /api/appointments/[id]),
-- so this log is the only place slot/patient facts survive. It backs the Revenue Recovery
-- "cancelled_90d" category and is the trigger source for waitlist matching.
CREATE TABLE IF NOT EXISTS appointment_cancellations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id UUID,
  patient_id     UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name   TEXT,
  dentist_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  chair          INTEGER,
  appt_date      DATE NOT NULL,
  start_time     TIME NOT NULL,
  duration       INTEGER NOT NULL DEFAULT 30,
  type           TEXT,
  cancelled_by   UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_cancellations_tenant_date
  ON appointment_cancellations(tenant_id, appt_date DESC);
CREATE INDEX IF NOT EXISTS idx_appt_cancellations_patient
  ON appointment_cancellations(patient_id);

-- Distinguishes "job computed a real score" from "column still at its insert default",
-- so read paths know whether to trust risk_score or fall back to the live ratio.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS risk_score_computed_at TIMESTAMPTZ;

-- ─── WAITLIST (opt-in for earlier slots) ──────────────────────
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_type       TEXT NOT NULL,
  preferred_dentist_id UUID REFERENCES users(id),
  preferred_days       SMALLINT[],
  preferred_time_start TIME,
  preferred_time_end   TIME,
  min_duration         INTEGER NOT NULL DEFAULT 30,
  max_wait_until       DATE,
  notes                TEXT DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','offered','fulfilled','expired','cancelled')),
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_active
  ON waitlist_entries(tenant_id, status)
  WHERE status IN ('active','offered');
CREATE INDEX IF NOT EXISTS idx_waitlist_patient ON waitlist_entries(patient_id);

-- ─── SLOT OFFERS (waitlist candidate <-> freed slot) ──────────
CREATE TABLE IF NOT EXISTS slot_offers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waitlist_entry_id        UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  patient_id               UUID REFERENCES patients(id) ON DELETE SET NULL,
  cancelled_appointment_id UUID REFERENCES appointment_cancellations(id) ON DELETE SET NULL,
  offered_date             DATE NOT NULL,
  offered_start_time       TIME NOT NULL,
  offered_duration         INTEGER NOT NULL DEFAULT 30,
  offered_chair            INTEGER,
  offered_dentist_id       UUID REFERENCES users(id),
  notification_id          UUID REFERENCES notifications(id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'sent'
                             CHECK (status IN ('sent','accepted','declined','expired')),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  responded_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slot_offers_pending
  ON slot_offers(tenant_id, status)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_slot_offers_entry ON slot_offers(waitlist_entry_id);
