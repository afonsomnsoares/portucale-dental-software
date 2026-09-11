-- ─── CORREÇÃO: a fila de notificações podia enviar a mesma SMS duas vezes ────
-- lib/jobsRunner.ts's sendDueNotifications lia as linhas pendentes, chamava a
-- Twilio e só DEPOIS marcava a linha como enviada. Entre a leitura e a escrita
-- há uma chamada de rede a um fornecedor externo — segundos — e o SELECT não
-- tinha `FOR UPDATE SKIP LOCKED`, nem havia nada a impedir duas execuções do
-- pipeline de se sobreporem (o serviço `jobs` a reiniciar a meio, o cron a
-- disparar antes de a corrida anterior acabar, ou um admin a carregar em
-- POST /api/jobs/run ao mesmo tempo).
--
-- O resultado é o doente a receber o lembrete a dobrar, a clínica a pagar a
-- dobrar, e dois registos do mesmo envio no patient_timeline. É a única falha
-- desta base de código cuja consequência sai da aplicação e chega a uma pessoa.
--
-- A correção em lib/jobsRunner.ts reserva as linhas antes de enviar, numa só
-- instrução (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)), e
-- para isso precisa de um estado que diga «esta já é de alguém»: 'sending'.
-- Sem o acrescentar ao CHECK da migração 010, a reserva seria recusada pela
-- base de dados e a fila deixaria de funcionar de todo.
--
-- ─── Porque é que 'sending' reutiliza o next_retry_at ────────────────────────
-- Uma linha reservada por um processo que morre a meio do envio ficaria em
-- 'sending' para sempre: o WHERE da fila procura 'queued' e 'retry', e nunca
-- mais lhe tocaria. Em vez de uma coluna nova (claimed_at) e de um job de
-- recuperação só para ela, a reserva escreve next_retry_at = NOW() + 5 min e a
-- fila passa a aceitar também as linhas em 'sending' cujo next_retry_at já
-- passou. A semântica da coluna mantém-se exatamente a mesma que já tinha —
-- «não voltar a pegar nisto antes desta hora» — e a recuperação de um processo
-- morto passa a ser o caminho normal da fila, em vez de um caminho à parte que
-- só corre quando alguém se lembra de o escrever.
--
-- Idempotente: uma instalação nova recebe o CHECK já com 'sending' a partir de
-- scripts/schema.sql, por isso este bloco confirma o conteúdo da constraint
-- antes de mexer nela, em vez de assumir que a encontra na forma antiga.
DO $$
DECLARE
  definicao text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definicao
    FROM pg_constraint
   WHERE conname = 'notifications_status_check';

  -- Ausente (base por migrar) ou já com 'sending' (instalação nova): nada a fazer.
  IF definicao IS NULL OR definicao LIKE '%sending%' THEN
    RETURN;
  END IF;

  ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
    CHECK (status IN ('queued','sending','sent','failed','retry'));
END $$;

-- A fila procura por (status, next_retry_at) a cada passagem, por clínica. Sem
-- índice, é uma varredura sequencial sobre a tabela inteira de notificações —
-- que só cresce, porque as enviadas ficam lá como histórico.
CREATE INDEX IF NOT EXISTS idx_notifications_claimable
  ON notifications (tenant_id, status, next_retry_at)
  WHERE status IN ('queued','retry','sending');
