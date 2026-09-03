-- ─── Ligar o valor à consulta que o gerou ───────────────────────────────────────
-- O fluxo real de uma clínica é "no fim da consulta alguém coloca o valor", mas até
-- aqui as duas coisas viviam separadas: a consulta fechava em app/api/appointments/
-- [id]/status (estado 'departed') e a fatura nascia noutro sítio, à mão, sem nada a
-- ligá-las. Resultado: ninguém sabia que consulta gerou que valor, e era preciso
-- lembrar-se de ir criar o registo a seguir.
--
-- Esta plataforma NÃO processa pagamentos nem emite documentos fiscais — regista o
-- valor e a conta corrente do doente. A fatura legal é emitida pelo software
-- certificado da clínica. Ver o cabeçalho de app/api/invoices/route.ts.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

-- Uma consulta gera no máximo um registo de valor. O workflow já protege contra isto
-- ('departed' é terminal e não tem transições de saída), mas uma clínica pode
-- redefinir os seus próprios estados na migração 035 e abrir a porta a um segundo
-- fecho — o índice fecha-a na base de dados, que é onde tem de estar fechada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_appointment_unique
  ON invoices(appointment_id) WHERE appointment_id IS NOT NULL;

-- A pergunta "que consultas desta clínica já têm valor lançado?" é a que a receção faz
-- todos os dias ao fecho.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_appointment
  ON invoices(tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
