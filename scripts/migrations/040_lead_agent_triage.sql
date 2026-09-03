-- ─── Triagem de leads por IA ────────────────────────────────────────────────────
-- lib/agents/leadAgent.ts (o agente Lead — ver lib/agents/registry.ts) qualifica um
-- lead novo e escreve o rascunho da resposta, mas nunca envia sozinho: o envio real
-- passa por app/api/leads/[id]/send-reply/route.ts, que só uma pessoa desencadeia.
--
-- ai_triaged_at é o que decide se um lead ainda precisa de passar pelo agente — a
-- tarefa 'leadTriage' só processa leads com esta coluna a NULL, por isso nunca
-- reprocessa (e reescreve) um lead já triado. ai_reply_sent_at é a prova de que uma
-- pessoa reviu e mandou seguir o rascunho — nunca é preenchida pelo próprio agente.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_qualification TEXT CHECK (ai_qualification IN ('hot', 'warm', 'cold'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_intent TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_draft_channel TEXT CHECK (ai_draft_channel IN ('sms', 'email'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_draft_reply TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_triaged_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_reply_sent_at TIMESTAMPTZ;

-- A varredura da tarefa ('status=open AND ai_triaged_at IS NULL') é sempre pequena
-- (leads novos), mas o índice parcial evita que cresça para um scan completo da
-- tabela à medida que a clínica acumula anos de leads antigos.
CREATE INDEX IF NOT EXISTS idx_leads_untriaged ON leads(tenant_id, created_at)
  WHERE status = 'open' AND ai_triaged_at IS NULL;
