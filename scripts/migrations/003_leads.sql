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