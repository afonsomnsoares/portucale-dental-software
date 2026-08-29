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
  tenant_id   UUID REFERENCES tenants(id),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','receptionist','dentist')),
  clinic      TEXT NOT NULL DEFAULT 'Tower',
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PATIENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id),
  global_seq    SERIAL UNIQUE,
  name          TEXT NOT NULL,
  dob           DATE,
  phone         TEXT,
  email         TEXT,
  insurance     TEXT,
  balance       DECIMAL(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'registered',
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
  tenant_id   UUID REFERENCES tenants(id),
  patient_id  UUID REFERENCES patients(id),
  patient_name TEXT,
  dentist_id  UUID REFERENCES users(id),
  chair       INTEGER NOT NULL DEFAULT 1,
  appt_date   DATE NOT NULL,
  start_time  TIME NOT NULL,
  duration    INTEGER NOT NULL DEFAULT 30,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed',
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
  tenant_id   UUID REFERENCES tenants(id),
  patient_id  UUID REFERENCES patients(id),
  tooth_num   INTEGER,
  treatment_code TEXT,
  description TEXT NOT NULL,
  phase       INTEGER DEFAULT 1,
  status      TEXT DEFAULT 'proposed',
  fee         DECIMAL(10,2) DEFAULT 0,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INVOICES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  patient_id  UUID REFERENCES patients(id),
  patient_name TEXT,
  dentist_id  UUID REFERENCES users(id),
  amount      DECIMAL(10,2) NOT NULL,
  paid        DECIMAL(10,2) DEFAULT 0,
  method      TEXT DEFAULT '—',
  status      TEXT DEFAULT 'pending',
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
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (item_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  action     TEXT NOT NULL,
  allowed    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, role, action)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL,
  to_addr       TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'queued',
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
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  patient_id      UUID UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  medication    TEXT NOT NULL,
  dosage        TEXT DEFAULT '',
  frequency     TEXT DEFAULT '',
  route         TEXT DEFAULT '',
  duration      TEXT DEFAULT '',
  quantity      INTEGER DEFAULT 0,
  refills       INTEGER DEFAULT 0,
  instructions  TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  status        TEXT DEFAULT 'active',
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LAB ORDERS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  lab_name      TEXT NOT NULL,
  case_type     TEXT DEFAULT '',
  tooth_nums    TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  instructions  TEXT DEFAULT '',
  due_date      DATE,
  fee           DECIMAL(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'ordered',
  created_by    UUID REFERENCES users(id),
  received_by   UUID REFERENCES users(id),
  received_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TREATMENT PLANS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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
