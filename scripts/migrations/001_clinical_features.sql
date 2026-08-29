-- ─── MEDICAL HISTORY (anamnesis) ──────────────────────────────
CREATE TABLE IF NOT EXISTS medical_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  allergies     JSONB DEFAULT '[]'::jsonb,
  medications   JSONB DEFAULT '[]'::jsonb,
  conditions    JSONB DEFAULT '[]'::jsonb,
  family_history TEXT,
  smoking       TEXT DEFAULT 'never',
  pregnancy     BOOLEAN,
  notes         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id),
  UNIQUE(patient_id)
);

-- ─── PRESCRIPTIONS (eRx) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  medication      TEXT NOT NULL,
  dosage          TEXT NOT NULL,
  frequency       TEXT NOT NULL,
  route           TEXT DEFAULT 'oral',
  duration        TEXT,
  quantity        INTEGER,
  refills         INTEGER DEFAULT 0,
  instructions    TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'active',
  prescribed_by   UUID REFERENCES users(id),
  prescribed_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LAB ORDERS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  lab_name        TEXT NOT NULL,
  case_type       TEXT NOT NULL,
  tooth_nums      INTEGER[] DEFAULT '{}',
  description     TEXT,
  instructions    TEXT,
  due_date        DATE,
  fee             DECIMAL(10,2) DEFAULT 0,
  status          TEXT DEFAULT 'ordered',
  tracking_url    TEXT,
  ordered_by      UUID REFERENCES users(id),
  received_by     UUID REFERENCES users(id),
  ordered_at      TIMESTAMPTZ DEFAULT NOW(),
  received_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TREATMENT PLANS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  phases          JSONB DEFAULT '[]'::jsonb,
  total_fee       DECIMAL(10,2) DEFAULT 0,
  approved        BOOLEAN DEFAULT FALSE,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID REFERENCES users(id),
  signature_url   TEXT,
  status          TEXT DEFAULT 'draft',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RECALL SCHEDULE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recall_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  recall_type     TEXT NOT NULL DEFAULT 'checkup',
  interval_months INTEGER NOT NULL DEFAULT 6,
  last_done       DATE,
  next_due        DATE NOT NULL,
  notes           TEXT,
  active          BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CONSENT FORMS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  procedure_name  TEXT NOT NULL,
  description     TEXT,
  signed_by       TEXT NOT NULL,
  signed_at       TIMESTAMPTZ DEFAULT NOW(),
  signature_url   TEXT,
  storage_key     TEXT,
  content_type    TEXT DEFAULT 'application/pdf',
  file_size       INTEGER,
  status          TEXT DEFAULT 'signed',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_medhist_patient    ON medical_history(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_patient         ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_tenant          ON prescriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_patient        ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_tenant         ON lab_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_status         ON lab_orders(status);
CREATE INDEX IF NOT EXISTS idx_tp_patient         ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_tp_tenant          ON treatment_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recall_patient     ON recall_schedule(patient_id);
CREATE INDEX IF NOT EXISTS idx_recall_due         ON recall_schedule(next_due) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_consent_patient    ON consent_forms(patient_id);
CREATE INDEX IF NOT EXISTS idx_consent_tenant     ON consent_forms(tenant_id);
