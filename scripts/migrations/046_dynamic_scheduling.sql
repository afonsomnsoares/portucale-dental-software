-- ─── DYNAMIC SCHEDULING ────────────────────────────────────────────────────
-- Até aqui a agenda só se preenchia sozinha por reação a um cancelamento
-- (app/api/appointments/[id]/route.ts chama notifyWaitlistOfFreedSlot) e só a
-- partir de quem tinha feito opt-in explícito na lista de espera. Um buraco que
-- já existia na agenda era apenas uma PROPOSTA numa página
-- (lib/scheduleOptimizer.ts), à espera que alguém reparasse nela.
--
-- Esta migração abre as três portas que faltavam:
--
--   1. A oferta deixa de pertencer à lista de espera. `waitlist_entry_id` passa
--      a ser opcional e a oferta ganha `source`: a procura pode vir de um plano
--      de tratamento aceite e parado, de um recall vencido, de um doente com
--      consulta marcada muito à frente que aceitaria antecipar, ou de um doente
--      inativo. A lista de espera é agora uma fonte entre cinco.
--
--   2. A clínica passa a declarar até onde o agente vai
--      (tenant_scheduling_policy). É deliberado que o valor por omissão seja
--      'propose' — ligar o contacto automático é um ato consciente de quem
--      assina pela clínica, não um default que aparece com uma atualização.
--
--   3. As respostas dos doentes passam a existir (sms_inbound). O sistema já
--      mandava "responda SIM" desde a primeira versão do risco de falta, mas
--      não havia nada do outro lado a ler — o SIM caía numa caixa que ninguém
--      abria.

-- ─── 1. Ofertas genéricas ──────────────────────────────────────────────────
ALTER TABLE slot_offers ALTER COLUMN waitlist_entry_id DROP NOT NULL;

ALTER TABLE slot_offers
  -- De onde veio a procura. 'waitlist' é o que existia; o resto é novo. O
  -- default preenche as linhas antigas com a verdade histórica delas.
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'waitlist'
    CHECK (source IN ('waitlist','treatment_open','recall_due','advance','reactivation')),
  -- O tipo de consulta oferecido. Antes lia-se sempre por join a
  -- waitlist_entries.treatment_type; sem entrada na lista de espera não há de
  -- onde o ler, por isso passa a viver na própria oferta.
  ADD COLUMN IF NOT EXISTS offered_type TEXT,
  -- A pontuação de compatibilidade que levou a esta oferta e a frase que a
  -- explica (ver lib/demandPoolCalc.ts). Guardadas para a decisão ser auditável
  -- depois de tomada — sem isto, "porque é que ligaram a este doente?" não tem
  -- resposta.
  ADD COLUMN IF NOT EXISTS score NUMERIC,
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS estimated_value_eur NUMERIC,
  -- Antecipação: a consulta que o doente JÁ tinha e que esta oferta substitui.
  -- Preenchida só quando source='advance'. Ao aceitar, a antiga é cancelada na
  -- mesma transação — senão o doente ficava com duas.
  ADD COLUMN IF NOT EXISTS advance_from_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  -- Quando esta oferta caduca. Antes o prazo era uma constante em código
  -- (OFFER_EXPIRY_HOURS); passa a ser por oferta porque a política da clínica
  -- pode encurtá-lo, e uma vaga para amanhã não pode esperar 24h.
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  -- Se um "SIM" do doente marca a consulta sozinho. Fotografia da política no
  -- momento em que a oferta saiu: mudar a política a meio não pode alterar o
  -- contrato de uma oferta que já está na mão do doente.
  ADD COLUMN IF NOT EXISTS auto_book BOOLEAN NOT NULL DEFAULT FALSE,
  -- A consulta criada quando a oferta foi aceite.
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

-- Backfill do tipo nas ofertas que já existem, a partir da entrada da lista de
-- espera de onde vinham. Sem isto, uma oferta antiga ainda pendente ficava sem
-- tipo e a aceitação criava uma consulta com type NULL.
UPDATE slot_offers o
   SET offered_type = w.treatment_type
  FROM waitlist_entries w
 WHERE w.id = o.waitlist_entry_id AND o.offered_type IS NULL;

-- Idem para o prazo: as pendentes mantêm as 24h com que foram criadas.
UPDATE slot_offers SET expires_at = created_at + INTERVAL '24 hours'
 WHERE expires_at IS NULL AND status = 'sent';

-- A varredura de expiração e a resposta por SMS procuram sempre por
-- (clínica, pendentes, prazo).
CREATE INDEX IF NOT EXISTS idx_slot_offers_expiring
  ON slot_offers(tenant_id, expires_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_slot_offers_patient_pending
  ON slot_offers(patient_id, created_at DESC) WHERE status = 'sent';

-- ─── 2. Política de autonomia por clínica ──────────────────────────────────
-- Uma linha por clínica. A ausência de linha é um estado válido e significa os
-- valores por omissão de lib/schedulingPolicyCalc.ts — nenhuma clínica precisa
-- de configurar nada para o produto funcionar como funcionava antes.
CREATE TABLE IF NOT EXISTS tenant_scheduling_policy (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- A escada de autonomia, do mais fechado ao mais aberto:
  --   'off'      — o agente não faz nada. Existe para uma clínica poder desligar
  --                sem se desinstalar.
  --   'propose'  — calcula e mostra; ninguém é contactado. É o comportamento
  --                que o produto tinha antes desta migração, e por isso o default.
  --   'contact'  — o agente contacta os doentes que escolheu, mas a marcação
  --                continua a passar por uma pessoa.
  --   'autobook' — um "SIM" do doente marca a consulta sozinho.
  mode                 TEXT NOT NULL DEFAULT 'propose'
                         CHECK (mode IN ('off','propose','contact','autobook')),
  -- Quantos doentes se contactam pelo mesmo espaço livre. Mais do que isto e a
  -- clínica arrisca prometer a mesma cadeira a gente a mais.
  max_offers_per_slot  INTEGER NOT NULL DEFAULT 3 CHECK (max_offers_per_slot BETWEEN 1 AND 10),
  -- Teto diário de contactos automáticos da clínica inteira, somando todas as
  -- fontes. É o travão que impede o agente de fazer uma campanha de SMS por
  -- engano num dia em que a agenda esteja vazia.
  daily_contact_cap    INTEGER NOT NULL DEFAULT 30 CHECK (daily_contact_cap BETWEEN 0 AND 1000),
  -- Horas de silêncio, na hora local da clínica. Fora delas não sai nada.
  quiet_hours_start    SMALLINT NOT NULL DEFAULT 21 CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end      SMALLINT NOT NULL DEFAULT 9  CHECK (quiet_hours_end BETWEEN 0 AND 23),
  -- Pontuação mínima (0-100) para uma oferta valer um contacto. Abaixo disto o
  -- candidato aparece na página mas não recebe SMS.
  min_score            SMALLINT NOT NULL DEFAULT 45 CHECK (min_score BETWEEN 0 AND 100),
  -- Que fontes de procura o agente pode usar. Uma clínica pode querer encaixar
  -- planos de tratamento parados mas não reativar inativos, por exemplo.
  allowed_sources      TEXT[] NOT NULL DEFAULT ARRAY['waitlist','treatment_open','recall_due','advance']::TEXT[],
  -- Quantos dias à frente o agente procura espaços livres.
  horizon_days         SMALLINT NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 60),
  -- Validade de cada oferta.
  offer_expiry_hours   SMALLINT NOT NULL DEFAULT 24 CHECK (offer_expiry_hours BETWEEN 1 AND 168),
  -- Dias mínimos entre dois contactos automáticos ao mesmo doente, qualquer que
  -- seja a fonte. Protege quem cabe em muitos buracos de ser o mais incomodado.
  patient_cooldown_days SMALLINT NOT NULL DEFAULT 7 CHECK (patient_cooldown_days BETWEEN 0 AND 90),
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_set_updated_at ON tenant_scheduling_policy;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON tenant_scheduling_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Respostas recebidas ────────────────────────────────────────────────
-- O outro lado do SMS. Guarda-se a mensagem crua além da intenção interpretada:
-- quando a leitura falhar (e vai falhar — as pessoas escrevem "sim pode ser",
-- "so depois das 6"), é preciso poder ver o que a pessoa escreveu mesmo.
CREATE TABLE IF NOT EXISTS sms_inbound (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL quando o número não corresponde a nenhum doente de nenhuma clínica.
  -- Guarda-se na mesma: um número desconhecido a responder é informação, e
  -- descartá-lo em silêncio esconderia um erro de configuração do provedor.
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id   UUID REFERENCES patients(id) ON DELETE SET NULL,
  slot_offer_id UUID REFERENCES slot_offers(id) ON DELETE SET NULL,
  from_addr    TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  -- O que se percebeu da mensagem — ver lib/smsReplyCalc.ts.
  intent       TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (intent IN ('accept','decline','stop','unknown')),
  -- O que o sistema fez a seguir, em texto, para a receção perceber sem ter de
  -- cruzar tabelas.
  outcome      TEXT NOT NULL DEFAULT '',
  -- O id da mensagem no provedor. UNIQUE porque o Twilio reentrega o mesmo
  -- webhook quando não recebe 200 a tempo, e marcar uma consulta duas vezes por
  -- causa de um timeout de rede é exatamente o tipo de erro que não se descobre.
  provider_id  TEXT UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_inbound_tenant ON sms_inbound(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_inbound_patient ON sms_inbound(patient_id, created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Mesma política das restantes tabelas com tenant_id (ver 011_row_level_security.sql).
-- sms_inbound tem o caso extra da linha órfã (tenant_id NULL), tratado como em
-- agent_insights (migração 041): só o super-admin a vê.
ALTER TABLE tenant_scheduling_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_scheduling_policy FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_scheduling_policy' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON tenant_scheduling_policy
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE sms_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_inbound FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sms_inbound' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON sms_inbound
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
