-- ============================================================
-- Portucale Dental — Full PostgreSQL Schema (Portugal)
-- Run: psql -d portucale_dental -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TENANTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  operatories INTEGER NOT NULL DEFAULT 3,
  status      TEXT NOT NULL DEFAULT 'provisioning',
  uptime      TEXT DEFAULT '—',
  created_at  DATE DEFAULT CURRENT_DATE
);

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable by design: NULL marks the platform super_admin (no single
  -- clinic). Every other row must have a tenant — enforced below by
  -- users_role_tenant_consistency, not NOT NULL (which would break the
  -- super_admin concept).
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- super_admin: platform-wide, exactly one, tenant_id always NULL — see
  -- app/api/auth/bootstrap/route.ts. admin: a clinic's own admin, tenant_id
  -- always set, and a tenant can have more than one (created via
  -- POST /api/users by a super_admin) — see scripts/migrations/017_super_admin_role.sql.
  role        TEXT NOT NULL CHECK (role IN ('super_admin','admin','receptionist','dentist')),
  clinic      TEXT NOT NULL DEFAULT 'Tower',
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT users_role_tenant_consistency CHECK ((role = 'super_admin') = (tenant_id IS NULL))
);

-- ─── PATIENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  global_seq    SERIAL UNIQUE,
  name          TEXT NOT NULL,
  dob           DATE,
  phone         TEXT,
  email         TEXT,
  insurance     TEXT,
  balance       DECIMAL(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'registered'
    CHECK (status IN ('registered','waiting','in-operatory','ready-dismissal','departed')),
  custom_fields JSONB DEFAULT '{}'::jsonb,
  no_show_count INTEGER DEFAULT 0,
  visit_count   INTEGER DEFAULT 0,
  last_visit    DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LEADS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  source      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'lost')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_open_tenant
  ON leads(tenant_id, created_at DESC)
  WHERE status = 'open';

-- ─── MEDICAL ALERTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  alert      TEXT NOT NULL,
  severity   TEXT DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── APPOINTMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE): patient_name below is a snapshot kept for exactly
  -- this case, so the appointment record survives a deleted patient.
  patient_id  UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  dentist_id  UUID REFERENCES users(id),
  chair       INTEGER NOT NULL DEFAULT 1,
  appt_date   DATE NOT NULL,
  start_time  TIME NOT NULL,
  duration    INTEGER NOT NULL DEFAULT 30,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','waiting','in-operatory','procedure-active','ready-dismissal','departed','no-show')),
  risk_score  INTEGER DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TEETH ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teeth (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  tooth_num   INTEGER NOT NULL CHECK (tooth_num BETWEEN 1 AND 32),
  condition   TEXT NOT NULL DEFAULT 'healthy',
  surfaces    TEXT[] DEFAULT '{}',
  notes       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id),
  UNIQUE(patient_id, tooth_num)
);

-- ─── TREATMENTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose (no name-snapshot column, clinical retention
  -- rules apply) — see scripts/migrations/009_fk_on_delete_consistency.sql.
  patient_id  UUID REFERENCES patients(id),
  tooth_num   INTEGER,
  treatment_code TEXT,
  description TEXT NOT NULL,
  phase       INTEGER DEFAULT 1,
  status      TEXT DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','completed')),
  fee         DECIMAL(10,2) DEFAULT 0,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INVOICES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE): patient_name below is a snapshot kept for exactly
  -- this case — invoices are financial records with their own retention
  -- rules, so they survive a deleted patient rather than disappearing.
  patient_id  UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  dentist_id  UUID REFERENCES users(id),
  amount      DECIMAL(10,2) NOT NULL,
  paid        DECIMAL(10,2) DEFAULT 0,
  method      TEXT DEFAULT '—',
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  invoice_date DATE DEFAULT CURRENT_DATE,
  due_date    DATE,
  items       JSONB DEFAULT '[]'::jsonb,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PATIENT TIMELINE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_timeline (
  id          BIGSERIAL PRIMARY KEY,
  -- Left RESTRICT on purpose (append-only audit trail, no name snapshot) —
  -- see scripts/migrations/009_fk_on_delete_consistency.sql.
  patient_id  UUID REFERENCES patients(id),
  user_name   TEXT NOT NULL,
  user_role   TEXT NOT NULL,
  event_type  TEXT NOT NULL DEFAULT 'admin',
  event       TEXT NOT NULL,
  hash        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SCHEMA FIELDS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_fields (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  label       TEXT,
  description TEXT,
  field_type  TEXT NOT NULL,
  enum_values JSONB,
  rollout     INTEGER DEFAULT 0,
  required    BOOLEAN DEFAULT FALSE,
  pushed_at   DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_fields_tenant_field
  ON schema_fields(tenant_id, field_name)
  WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_fields_global_field
  ON schema_fields(field_name)
  WHERE tenant_id IS NULL;

-- ─── SETTINGS (LOOKUPS) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_codes (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  fee         DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS tooth_conditions (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS statuses (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  bg          TEXT NOT NULL,
  color       TEXT NOT NULL,
  transitions TEXT[] DEFAULT '{}'
);


-- ─── AUDIT LOG (append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_name   TEXT NOT NULL,
  user_role   TEXT NOT NULL,
  clinic      TEXT NOT NULL DEFAULT 'Tower',
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  before_val  TEXT,
  after_val   TEXT,
  hash        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent modification of audit log
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Prevent modification of patient timeline
REVOKE UPDATE, DELETE ON patient_timeline FROM PUBLIC;

-- ─── INVENTORY ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id          SERIAL PRIMARY KEY,
  item        TEXT NOT NULL,
  unit        TEXT DEFAULT 'unit',
  reorder_at  INTEGER DEFAULT 10,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_stock (
  item_id     INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (item_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  action     TEXT NOT NULL,
  allowed    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, role, action)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL,
  to_addr       TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','retry')),
  provider_id   TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGSERIAL PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id   UUID REFERENCES patients(id) ON DELETE SET NULL,
  storage      TEXT NOT NULL DEFAULT 'local',
  storage_key  TEXT NOT NULL,
  url          TEXT NOT NULL,
  content_type TEXT,
  size         INTEGER,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MEDICAL HISTORY ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Left RESTRICT on purpose (clinical record, retention rules apply, no
  -- name-snapshot column) — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id      UUID UNIQUE REFERENCES patients(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  allergies       TEXT DEFAULT '',
  medications     TEXT DEFAULT '',
  conditions      TEXT DEFAULT '',
  family_history  TEXT DEFAULT '',
  smoking         TEXT DEFAULT '',
  pregnancy       TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PRESCRIPTIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id    UUID REFERENCES patients(id),
  medication    TEXT NOT NULL,
  dosage        TEXT DEFAULT '',
  frequency     TEXT DEFAULT '',
  route         TEXT DEFAULT '',
  duration      TEXT DEFAULT '',
  quantity      INTEGER DEFAULT 0,
  refills       INTEGER DEFAULT 0,
  instructions  TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  status        TEXT DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LAB ORDERS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id    UUID REFERENCES patients(id),
  lab_name      TEXT NOT NULL,
  case_type     TEXT DEFAULT '',
  tooth_nums    TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  instructions  TEXT DEFAULT '',
  due_date      DATE,
  fee           DECIMAL(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'ordered' CHECK (status IN ('ordered','sent','in-progress','received')),
  created_by    UUID REFERENCES users(id),
  received_by   UUID REFERENCES users(id),
  received_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TREATMENT PLANS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id    UUID REFERENCES patients(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  phases        JSONB DEFAULT '[]'::jsonb,
  total_fee     DECIMAL(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'draft',
  approved      BOOLEAN DEFAULT FALSE,
  approved_at   TIMESTAMPTZ,
  approved_by   UUID REFERENCES users(id),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RECALLS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recalls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id      UUID REFERENCES patients(id),
  recall_type     TEXT NOT NULL,
  interval_months INTEGER DEFAULT 6,
  last_done       DATE,
  next_due        DATE,
  notes           TEXT DEFAULT '',
  active          BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CONSENT FORMS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Left RESTRICT on purpose — see scripts/migrations/014_patient_deletion_restrict.sql.
  patient_id      UUID REFERENCES patients(id),
  procedure_name  TEXT NOT NULL,
  description     TEXT DEFAULT '',
  signed_by       TEXT DEFAULT '',
  signature_url   TEXT DEFAULT '',
  storage_key     TEXT DEFAULT '',
  file_size       INTEGER DEFAULT 0,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RGPD: CONSENTIMENTO PARA TRATAMENTO DE DADOS ───────────
CREATE TABLE IF NOT EXISTS patient_data_consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  consent_type    TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  lawful_basis    TEXT NOT NULL DEFAULT 'consent',
  given           BOOLEAN NOT NULL DEFAULT TRUE,
  given_at        TIMESTAMPTZ DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT DEFAULT '',
  version         TEXT NOT NULL DEFAULT '1.0',
  created_by      UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_data_consents_pt ON patient_data_consents(patient_id);

-- ─── RGPD: PEDIDOS DE EXERCÍCIO DE DIREITOS ──────────────────
CREATE TABLE IF NOT EXISTS data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  request_type    TEXT NOT NULL CHECK (request_type IN ('access','rectification','erasure','portability','restriction','objection')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','rejected')),
  notes           TEXT DEFAULT '',
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_pt ON data_subject_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status);

-- ─── RGPD: REGISTO DE ATIVIDADES DE TRATAMENTO ───────────────
CREATE TABLE IF NOT EXISTS processing_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_name   TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  lawful_basis    TEXT NOT NULL,
  data_categories TEXT NOT NULL DEFAULT '',
  recipients      TEXT DEFAULT '',
  retention_period TEXT DEFAULT '',
  security_measures TEXT DEFAULT '',
  cross_border    BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RGPD: POLÍTICAS DE CONSERVAÇÃO ──────────────────────────
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_category   TEXT NOT NULL,
  retention_days  INTEGER NOT NULL,
  action          TEXT NOT NULL DEFAULT 'anonymize' CHECK (action IN ('delete','anonymize','archive')),
  description     TEXT DEFAULT '',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RGPD: CONTACTO DPO ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS dpo_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RGPD: POLÍTICA DE PRIVACIDADE ───────────────────────────
CREATE TABLE IF NOT EXISTS privacy_notices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version         TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  effective_date  DATE NOT NULL,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PACIENTES: CAMPOS RGPD ──────────────────────────────────
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nif TEXT DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS postal_code TEXT DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'PT';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS data_consent_given BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS data_consent_date TIMESTAMPTZ;

-- ─── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_tenant    ON patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date  ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appointments_pt    ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_timeline_patient   ON patient_timeline(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teeth_patient      ON teeth(patient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_due  ON notifications(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_prescriptions_pt   ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_pt      ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_pt ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_recalls_pt         ON recalls(patient_id);
CREATE INDEX IF NOT EXISTS idx_consent_forms_pt   ON consent_forms(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant    ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_patient   ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date      ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_treatment_codes_code ON treatment_codes(code);

-- ─── DEFAULT PRIVILEGES: no table is public by default ────────
-- This app never lets a client talk to Postgres directly (all access goes
-- through the Next.js API routes, which own tenant/permission checks in
-- code — see lib/tenantGuard.ts, lib/permissions.ts). PUBLIC here is the
-- Postgres pseudo-role granted to *every* login role, so this is defense in
-- depth: even if another role is ever added to this database (a read-only
-- reporting user, a future direct-DB integration, ...), it starts with zero
-- access instead of inheriting whatever PUBLIC has. The table owner (the
-- role this migration runs as) keeps full rights regardless of these
-- REVOKEs, so the app itself is unaffected.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
CREATE INDEX IF NOT EXISTS idx_patients_nif       ON patients(nif);

-- ─── ROW-LEVEL SECURITY: DB-level backstop for tenant isolation ─────────────
-- See scripts/migrations/011_row_level_security.sql for the full rationale.
-- Only takes effect once the app connects as portucale_app instead of the
-- table owner — superusers/owners bypass RLS regardless of FORCE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portucale_app') THEN
    CREATE ROLE portucale_app LOGIN;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO portucale_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO portucale_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO portucale_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO portucale_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO portucale_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO portucale_app;
REVOKE UPDATE, DELETE ON audit_log, patient_timeline FROM portucale_app;

-- Only the tables schema.sql itself creates go here — appointment_cancellations,
-- waitlist_entries, slot_offers, patient_lifecycle_state, recall_schedule and
-- recovery_snapshots don't exist yet at this point (they're added by
-- scripts/migrations/*.sql, applied after this file by `npm run db:migrate`);
-- scripts/migrations/011_row_level_security.sql covers the complete set,
-- including those six, once migrate.ts has run.
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'consent_forms','data_retention_policies','data_subject_requests','dpo_contacts',
    'inventory_stock','invoices','lab_orders','leads','medical_history','notifications',
    'patient_data_consents','patients','prescriptions','privacy_notices','processing_activities',
    'recalls','role_permissions','treatment_plans','treatments','uploads','users'
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

-- patient_timeline, audit_log and teeth have no tenant_id column to key a
-- policy on — left uncovered, same app-level-only trust as today.

-- ─── AUDIT TRAIL: hash-chain tamper-evidence ─────────────────────────────────
-- See scripts/migrations/015_audit_hash_chain.sql for the full rationale.
-- Each row's hash chains to the previous one (sha256(prev_hash || fields)),
-- computed here rather than trusting whatever lib/audit.ts sends.
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

-- ─── updated_at: kept current automatically on every UPDATE ─────────────────
-- See scripts/migrations/016_updated_at_triggers.sql for the full rationale.
-- patient_lifecycle_state and waitlist_entries excluded here — same reason as
-- the RLS section above: they don't exist yet at this point (added by
-- migrations 007 and 004 respectively, applied after this file by
-- `npm run db:migrate`); migration 016 covers both once migrate.ts has run.
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
    'lab_orders','leads','medical_history','prescriptions',
    'processing_activities','recalls','teeth','treatment_plans','treatments'
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
