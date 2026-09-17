-- ─── Quando é que esta consulta foi MOVIDA ──────────────────────────────────
-- `appointments.created_at` diz quando a consulta nasceu e nunca mais muda. Até aqui não
-- havia nada a dizer quando ela mudou de dia — e isso tem duas consequências, ambas
-- silenciosas.
--
-- A primeira é para o doente: a tarefa 'confirmations' (lib/jobsRunner.ts) varre por
-- `created_at`, por isso uma consulta marcada na semana passada e movida hoje não produz
-- mensagem nenhuma. A clínica muda-lhe o dia e ele fica a saber na véspera, pelo
-- lembrete — ou não fica, se o lembrete já tiver saído para a data antiga.
--
-- A segunda é para a clínica: «quantas consultas remarcámos este mês» não era uma
-- pergunta que a base de dados soubesse responder. Um cancelamento deixa linha em
-- appointment_cancellations; uma remarcação não deixava rasto nenhum — a consulta
-- simplesmente passava a ter outra data, como se sempre a tivesse tido.
--
-- NULL significa «nunca foi movida», que é diferente de «foi movida no dia em que
-- nasceu». Por isso nullable e sem default: um default igual a created_at faria toda a
-- agenda existente parecer remarcada, e a primeira passagem do cron mandaria uma
-- mensagem de remarcação a todos os doentes da clínica.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ;

-- A varredura das confirmações filtra por «mexida recentemente», e com a coluna nova
-- isso é GREATEST(created_at, rescheduled_at). O índice cobre o caso que interessa —
-- consultas futuras — e não a agenda histórica inteira.
CREATE INDEX IF NOT EXISTS idx_appointments_recently_touched
  ON appointments (tenant_id, GREATEST(created_at, COALESCE(rescheduled_at, created_at)))
  WHERE status IN ('confirmed','waiting');
