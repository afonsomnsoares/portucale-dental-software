-- ─── O AGENTE PASSA A SER SÓ CHAMADA E SMS ──────────────────────────────────
-- Decisão de produto: a clínica não usa WhatsApp nem e-mail para falar com doentes. O
-- canal de entrada (migração 049) nasceu com cinco canais — whatsapp, sms, email,
-- webchat, voice — e ficam dois: `sms` e `voice`.
--
-- Não é só apagar opções de uma lista. Cada canal a mais é uma superfície de ataque
-- (um webhook público), uma conta de terceiros a manter, um formato de payload a
-- normalizar e um caminho de código que ninguém exercita. Tirá-los agora, antes de
-- existirem em produção, é muito mais barato do que os manter «por precaução».
--
-- ─── O que NÃO sai ──────────────────────────────────────────────────────────
-- `patients.email` fica. É dado de registo — identifica o doente, aparece em faturas e
-- no portal, e é um dos campos obrigatórios de lib/missingData.ts. O que sai é o e-mail
-- como CANAL do agente, não como campo da ficha. São coisas diferentes e confundi-las
-- apagaria dados de doentes por causa de uma decisão sobre comunicação.
--
-- `patient_interactions.channel` mantém 'email': é um registo MANUAL do que aconteceu no
-- mundo real, e um doente pode escrever um e-mail à clínica independentemente de nós
-- termos ou não um agente que os leia. Sai só 'whatsapp', porque essa via deixa de
-- existir de todo.

-- ─── 1. Conversas e contas de canal ─────────────────────────────────────────
-- As linhas dos canais removidos são apagadas e não convertidas: converter uma conversa
-- de WhatsApp em SMS inventaria um histórico que nunca existiu naquele canal. Em
-- produção não há nenhuma (o canal de entrada nunca chegou a ser ligado); em
-- desenvolvimento e testes há as que foram criadas a exercitar o código.
DELETE FROM conversation_messages
 WHERE conversation_id IN (SELECT id FROM conversations WHERE channel NOT IN ('sms', 'voice'));
DELETE FROM conversations WHERE channel NOT IN ('sms', 'voice');
DELETE FROM channel_accounts WHERE channel NOT IN ('sms', 'voice');

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('sms', 'voice'));

ALTER TABLE channel_accounts DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_channel_check
  CHECK (channel IN ('sms', 'voice'));

-- ─── 2. Registo manual de interações ────────────────────────────────────────
-- 'whatsapp' passa a 'other' em vez de as linhas serem apagadas: ao contrário das
-- conversas, isto é o registo de uma conversa que uma pessoa teve mesmo, escrito por
-- ela. Apagá-lo destruiria o histórico do doente por causa de uma mudança nossa.
UPDATE patient_interactions SET channel = 'other' WHERE channel = 'whatsapp';

ALTER TABLE patient_interactions DROP CONSTRAINT IF EXISTS patient_interactions_channel_check;
ALTER TABLE patient_interactions ADD CONSTRAINT patient_interactions_channel_check
  CHECK (channel IN ('phone', 'email', 'sms', 'in_person', 'other'));

-- ─── 3. Preferências de comunicação ─────────────────────────────────────────
-- Um canal preferido que já não existe é pior do que nenhum: a receção lê «WhatsApp» na
-- ficha e vai procurar uma conversa que o sistema não tem. Volta a «sem preferência».
UPDATE patients
   SET comm_prefs = comm_prefs - 'preferredChannel'
 WHERE comm_prefs->>'preferredChannel' IN ('whatsapp', 'email');

-- O opt-out de um canal que deixou de existir não protege nada — mas o de SMS e de
-- telefone protege, e esses ficam intactos. Só se remove a entrada morta da lista.
UPDATE patients
   SET comm_prefs = jsonb_set(
         comm_prefs,
         '{doNotContact}',
         (SELECT COALESCE(to_jsonb(ARRAY(
            SELECT v FROM jsonb_array_elements_text(comm_prefs->'doNotContact') AS t(v)
             WHERE v IN ('sms', 'phone')
          )), '[]'::jsonb))
       )
 WHERE jsonb_typeof(comm_prefs->'doNotContact') = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(comm_prefs->'doNotContact') AS t(v)
      WHERE v NOT IN ('sms', 'phone')
   );

-- ─── 4. Rascunhos do agente Lead ────────────────────────────────────────────
-- O agente Lead escolhia SMS quando havia telefone e e-mail quando não havia. O ramo do
-- e-mail nunca chegou a enviar nada — app/api/leads/[id]/send-reply/route.ts devolvia
-- 'email_not_supported' desde sempre — por isso isto não remove capacidade nenhuma:
-- torna explícito o que já era verdade. Um lead sem telefone deixa de ter rascunho, e
-- fica para contacto manual.
UPDATE leads SET ai_draft_channel = NULL, ai_draft_reply = NULL, ai_qualification = NULL, ai_triaged_at = NULL
 WHERE ai_draft_channel = 'email' AND ai_reply_sent_at IS NULL;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_ai_draft_channel_check;
ALTER TABLE leads ADD CONSTRAINT leads_ai_draft_channel_check
  CHECK (ai_draft_channel IS NULL OR ai_draft_channel = 'sms');

-- ─── 5. Definições de comunicação ───────────────────────────────────────────
-- `tenant_comms_settings.autonomy_level` não muda: a escada de autonomia é sobre O QUE a
-- IA pode responder, não sobre por onde. Mas o degrau 'informational' e acima passam a
-- aplicar-se só a SMS — uma chamada nunca recebe resposta automática, porque responder a
-- uma chamada é falar, e isso é uma pessoa. Ver lib/conversationCalc.ts.
COMMENT ON COLUMN tenant_comms_settings.autonomy_level IS
  'Até onde a IA pode responder sozinha, por SMS. Chamadas nunca recebem resposta automática (ver lib/conversationCalc.ts).';
