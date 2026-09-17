-- ─── O grupo como coisa explícita ───────────────────────────────────────────
-- Até aqui «o grupo» era uma convenção: lib/reports.ts:computeClinicComparison lê TODAS
-- as clínicas activas e compara-as, e o agente Grupo escreve as conclusões com
-- tenant_id NULL. Funciona enquanto um deploy servir um grupo só — que é o caso — mas
-- deixa duas perguntas sem sítio onde viver: quem é que manda no grupo, e o que é que o
-- grupo tem autorização para fazer com os doentes de cada unidade.
--
-- Esta migração responde à segunda, que é a que bloqueia tudo o resto.

-- ─── A porta legal, fechada ────────────────────────────────────────────────
-- Oferecer a um doente de Lisboa uma vaga no Porto não é uma optimização de agenda: é
-- comunicar dados de um doente entre dois responsáveis pelo tratamento distintos, e
-- contactá-lo em nome de uma entidade com que ele nunca falou.
--
-- Não há desenho de software que torne isso legal por si. O que há é o sítio onde a
-- clínica declara que tem base para o fazer — e, enquanto não declarar, o produto vê a
-- oportunidade e não age sobre ela. FALSE por omissão, e é para ficar: uma clínica que
-- actualize o código não passa a poder transferir doentes por causa de uma migração.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_transfers_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Quem assinou e quando, porque «está ligado» não é resposta a uma pergunta de um
-- regulador. Texto livre de propósito: a base legal de cada grupo é diferente e não cabe
-- num enum que nós inventemos.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_transfers_basis TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_transfers_enabled_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS group_transfers_enabled_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- O interruptor da clínica não substitui a vontade do doente. São as duas condições, e a
-- ordem entre elas não importa porque faltando uma não se faz nada: o mesmo desenho que
-- REACTIVATION_CONSENT_TYPE já usa para a reactivação (lib/lifecycleCalc.ts).
--
-- Nada a criar aqui: `patient_data_consents` já aceita qualquer `consent_type`. Fica o
-- nome escrito para não haver duas grafias do mesmo consentimento em ficheiros
-- diferentes — ver GROUP_TRANSFER_CONSENT em lib/group.ts.
COMMENT ON COLUMN tenants.group_transfers_enabled IS
  'Permite propor a um doente desta clínica uma vaga noutra unidade do grupo. Exige, além disto, consentimento do próprio (patient_data_consents, consent_type=group_transfer).';

-- A leitura que o nível de grupo faz é sempre «todas as clínicas activas», e é feita
-- clínica a clínica. Este índice serve o filtro que ela repete em cada uma.
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(status) WHERE status = 'active';
