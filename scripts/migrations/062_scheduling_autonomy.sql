-- ─── O degrau que não existia ───────────────────────────────────────────────
-- O nível de autonomia mais alto chamava-se 'transactional' e o comentário de
-- lib/inbound.ts dizia-o por extenso: «alterar a agenda sozinha é um degrau que ainda
-- não existe, e fingir que existe seria pior do que não o ter». Passa a existir, por
-- decisão do dono do produto, e chama-se 'agenda'.
--
-- É um degrau NOVO e não uma mudança ao 'transactional': uma clínica que já tenha
-- escolhido o nível anterior não passa a deixar o software mexer-lhe na agenda por causa
-- de uma migração. Quem quiser isto tem de o ir ligar.
DO $$
BEGIN
  ALTER TABLE tenant_comms_settings DROP CONSTRAINT IF EXISTS tenant_comms_settings_autonomy_level_check;
  ALTER TABLE tenant_comms_settings ADD CONSTRAINT tenant_comms_settings_autonomy_level_check
    CHECK (autonomy_level IN ('off', 'acknowledge', 'informational', 'transactional', 'agenda'));
END $$;

-- ─── Uma vaga oferecida é uma vaga oferecida, venha de onde vier ────────────
-- `slot_offers` é o mecanismo que já existia para «propusemos-lhe este lugar concreto,
-- responda para ficar com ele»: tem expiração (OFFER_EXPIRY_HOURS), tem a varredura que
-- liberta o que não foi respondido, e tem o caminho de aceitação que marca a consulta
-- dentro de uma transação. Tudo isso é exatamente o que o recall e a caixa de entrada
-- precisam agora.
--
-- Só estava preso à lista de espera: `waitlist_entry_id NOT NULL`. Construir uma segunda
-- tabela para a mesma coisa daria duas expirações, dois caminhos de aceitação e duas
-- oportunidades de marcar a mesma cadeira duas vezes.
ALTER TABLE slot_offers ALTER COLUMN waitlist_entry_id DROP NOT NULL;

ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'waitlist'
  CHECK (origin IN ('waitlist', 'recall', 'inbound'));
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS recall_id UUID REFERENCES recalls(id) ON DELETE SET NULL;

-- O tipo de consulta vinha por junção a waitlist_entries.treatment_type. Sem entrada na
-- lista de espera não há de onde o ler, por isso passa a viver na própria oferta. As
-- linhas antigas copiam o que a junção dava — senão a aceitação de uma oferta anterior a
-- esta migração marcaria uma consulta sem tipo.
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS offered_type TEXT;

UPDATE slot_offers o
   SET offered_type = w.treatment_type
  FROM waitlist_entries w
 WHERE w.id = o.waitlist_entry_id AND o.offered_type IS NULL;

-- A consistência que a coluna nullable abriu: uma oferta de lista de espera SEM entrada
-- de lista de espera é uma linha órfã que o ecrã da lista de espera nunca mostraria e a
-- varredura de expiração nunca apanharia (junta por waitlist_entry_id). Fecha-se aqui,
-- que é onde tem de estar fechado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_offers_origin_consistency') THEN
    ALTER TABLE slot_offers ADD CONSTRAINT slot_offers_origin_consistency
      CHECK (
        (origin = 'waitlist' AND waitlist_entry_id IS NOT NULL)
        OR (origin <> 'waitlist' AND waitlist_entry_id IS NULL)
      );
  END IF;
END $$;

-- Uma oferta por doente de cada vez, entre as que estão à espera de resposta. Sem isto,
-- um doente que escreva «quero marcar» três vezes recebe três lugares diferentes e pode
-- aceitar os três — e a clínica fica com três consultas para a mesma pessoa, todas
-- marcadas por um SIM que ele acha que foi um só.
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_offers_one_pending_per_patient
  ON slot_offers(tenant_id, patient_id)
  WHERE status = 'sent' AND origin <> 'waitlist';

CREATE INDEX IF NOT EXISTS idx_slot_offers_conversation
  ON slot_offers(conversation_id) WHERE conversation_id IS NOT NULL;
