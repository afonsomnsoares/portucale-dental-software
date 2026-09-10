-- ─── CANAL DE ENTRADA ───────────────────────────────────────────────────────
-- A área mais incompleta do produto, e a que mais o separa do que quer ser. Até aqui o
-- sistema ENVIA e não CONVERSA: há SMS a sair por seis motivos diferentes e não existe
-- um único webhook de receção — nem WhatsApp, nem e-mail, nem voz, nem chat. Um doente
-- que responda «podem mudar para a semana seguinte?» está a falar com uma parede.
--
-- Toda a inteligência de que essa conversa precisa — disponibilidade, preferências,
-- cadeira, equipamento, risco de falta — está construída e testada há muito. Faltava a
-- porta, e faltava uma decisão de produto que continua por tomar: se a IA pode falar
-- sozinha com um doente. Esta migração constrói a porta e deixa a decisão explícita
-- num campo, com o valor de repouso em 'off'.

-- ─── 1. Contas de canal ─────────────────────────────────────────────────────
-- Uma clínica pode ter um número de WhatsApp, um de SMS e um endereço de e-mail. O
-- webhook precisa de saber, a partir do destinatário, de que clínica é a mensagem — é
-- esta tabela que faz essa resolução, e é por isso que o `address` é único
-- globalmente e não por clínica: duas clínicas com o mesmo número seria uma mensagem
-- sem dono possível.
CREATE TABLE IF NOT EXISTS channel_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email', 'webchat', 'voice')),
  -- O número em E.164, o endereço de e-mail, ou o identificador do widget de chat.
  address      TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  -- Segredo de verificação da assinatura do webhook, guardado em HASH e nunca em claro
  -- — mesmo tratamento dos tokens do portal do doente (migração 022). Um segredo de
  -- webhook legível na base de dados é um segredo que permite a qualquer pessoa com
  -- leitura injetar mensagens falsas de doentes.
  secret_hash  TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_address
  ON channel_accounts(channel, lower(address)) WHERE active;

-- ─── 2. Conversas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL enquanto não se souber quem é. Uma mensagem de um número desconhecido é uma
  -- conversa legítima — muitas vezes é um lead — e não pode ser recusada só por ainda
  -- não ter dono. SET NULL e não CASCADE porque `contact_address` abaixo é a fotografia
  -- que faz a conversa sobreviver a um doente apagado, tal como appointments.patient_name.
  patient_id    UUID REFERENCES patients(id) ON DELETE SET NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email', 'webchat', 'voice')),
  -- De onde vem: o número ou endereço do doente.
  contact_address TEXT NOT NULL,
  contact_name  TEXT DEFAULT '',
  state         TEXT NOT NULL DEFAULT 'awaiting_staff'
    CHECK (state IN ('awaiting_staff', 'awaiting_patient', 'escalated', 'resolved', 'closed')),
  -- A última intenção classificada (lib/conversationCalc.ts). Guardada e não derivada
  -- porque é o resultado de uma classificação sobre um texto que pode mudar de
  -- interpretação se o classificador melhorar — e o que interessa auditar é o que o
  -- sistema decidiu NAQUELE momento, não o que decidiria hoje.
  last_intent   TEXT,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  escalated_at  TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_inbox
  ON conversations(tenant_id, state, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_patient
  ON conversations(patient_id) WHERE patient_id IS NOT NULL;
-- Uma conversa aberta por contacto e canal: a segunda mensagem do mesmo número entra na
-- mesma conversa em vez de abrir uma nova. Parcial sobre os estados vivos, para que uma
-- conversa fechada não impeça a abertura de uma nova mais tarde (ver stateAfterInbound).
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_open_per_contact
  ON conversations(tenant_id, channel, lower(contact_address))
  WHERE state IN ('awaiting_staff', 'awaiting_patient', 'escalated');

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body            TEXT NOT NULL DEFAULT '',
  -- Quem escreveu uma mensagem de saída: uma pessoa, ou o sistema. NULL numa mensagem
  -- de entrada, e NULL numa resposta automática — é o `automated` que as distingue.
  sent_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  automated       BOOLEAN NOT NULL DEFAULT FALSE,
  -- A classificação e a decisão que o sistema tomou sobre ESTA mensagem, congeladas.
  -- Uma decisão automática sobre a comunicação de uma clínica tem de ser auditável, e
  -- auditável quer dizer que se lê o que foi decidido e porquê, meses depois.
  intent          TEXT,
  routing         JSONB,
  -- Identificador do fornecedor, para deduplicar reentregas: os webhooks de WhatsApp e
  -- SMS reenviam a mesma mensagem quando não recebem 200 a tempo, e sem isto uma
  -- reentrega criaria uma segunda mensagem idêntica e uma segunda tarefa.
  provider_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
  ON conversation_messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_provider
  ON conversation_messages(tenant_id, provider_id) WHERE provider_id IS NOT NULL;

-- ─── 3. A decisão que ainda não foi tomada ──────────────────────────────────
-- «A IA pode falar sozinha com um doente?» é uma decisão de produto e de
-- responsabilidade, não de engenharia. Escrevê-la no código seria tomá-la por quem a
-- tem de tomar. Fica aqui, com quatro degraus e o valor de repouso no primeiro —
-- ver AUTONOMY_LEVELS em lib/conversationCalc.ts, e a nota de cada degrau em
-- AUTONOMY_NOTES.
--
-- Duas coisas NÃO dependem deste campo, em nenhum degrau, e é importante que assim
-- seja: um pedido para não ser contactado é sempre processado (obrigação legal, a
-- retirada do consentimento tem de ser tão fácil como o dar), e qualquer assunto
-- clínico escala sempre para uma pessoa sem resposta automática (é a fronteira do
-- produto inteiro).
CREATE TABLE IF NOT EXISTS tenant_comms_settings (
  tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  autonomy_level  TEXT NOT NULL DEFAULT 'off'
    CHECK (autonomy_level IN ('off', 'acknowledge', 'informational', 'transactional')),
  -- Respostas de facto que a clínica autoriza a IA a dar no degrau 'informational'.
  -- Texto escrito por uma pessoa, não gerado: um horário inventado por um modelo é uma
  -- promessa que a clínica vai ter de honrar.
  opening_hours   TEXT DEFAULT '',
  address_text    TEXT DEFAULT '',
  acknowledgement TEXT DEFAULT 'Recebemos a sua mensagem. Respondemos assim que possível.',
  -- Fora deste intervalo nada automático sai. Uma resposta automática às 3h da manhã
  -- diz ao doente que não falou com ninguém.
  quiet_hours_start TIME DEFAULT '21:00',
  quiet_hours_end   TIME DEFAULT '08:00',
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['channel_accounts', 'conversations', 'conversation_messages', 'tenant_comms_settings'];
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

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['channel_accounts', 'conversations', 'tenant_comms_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl
    );
  END LOOP;
END $$;

-- Confirmação: deve devolver zero linhas (ver migração 033).
-- SELECT * FROM tenant_tables_without_rls;
