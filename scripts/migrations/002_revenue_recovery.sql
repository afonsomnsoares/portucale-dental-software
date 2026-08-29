-- ─── REVENUE RECOVERY SNAPSHOTS ───────────────────────────────
CREATE TABLE IF NOT EXISTS recovery_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_month  DATE NOT NULL,
  total_estimated DECIMAL(12,2) NOT NULL DEFAULT 0,
  categories      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_month)
);

CREATE INDEX IF NOT EXISTS idx_recovery_snapshots_tenant
  ON recovery_snapshots(tenant_id, snapshot_month DESC);
