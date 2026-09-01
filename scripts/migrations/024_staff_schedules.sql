-- ─── GESTÃO DA EQUIPA — Fase 1: horários, disponibilidade, férias ────────────
-- Item 11 da automação: hoje só existe CRUD de utilizadores e permissões por
-- role, nada de horário, disponibilidade ou férias. Estas duas tabelas são a
-- base de tudo o resto do item (distribuição de tarefas, cobertura, alertas
-- — fases seguintes): sem saber o horário de ninguém não há como calcular
-- "quem está livre agora".
--
-- staff_schedules é o turno semanal recorrente (não datas concretas) — várias
-- linhas por (user_id, weekday) são permitidas de propósito, para cobrir
-- turnos partidos (ex: manhã + tarde com intervalo ao almoço). Um turno nunca
-- atravessa a meia-noite (end_time > start_time, imposto pelo CHECK) — cobre
-- horário normal de clínica, não turnos noturnos; decisão deliberada, não
-- uma limitação esquecida.
--
-- staff_time_off é o pedido de férias/ausência com aprovação — mesmo padrão
-- pending/approved/rejected que outros fluxos de aprovação já usam neste
-- projeto (ex: treatment_plans.approved).
CREATE TABLE IF NOT EXISTS staff_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_user ON staff_schedules(user_id, weekday);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_tenant ON staff_schedules(tenant_id);

CREATE TABLE IF NOT EXISTS staff_time_off (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'vacation' CHECK (type IN ('vacation', 'sick', 'other')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  notes         TEXT DEFAULT '',
  requested_by  UUID REFERENCES users(id),
  approved_by   UUID REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_time_off_user ON staff_time_off(user_id, status);
CREATE INDEX IF NOT EXISTS idx_staff_time_off_tenant ON staff_time_off(tenant_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_schedules' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE staff_schedules FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON staff_schedules
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_time_off' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE staff_time_off ENABLE ROW LEVEL SECURITY;
    ALTER TABLE staff_time_off FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON staff_time_off
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON staff_schedules;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON staff_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON staff_time_off;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON staff_time_off
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
