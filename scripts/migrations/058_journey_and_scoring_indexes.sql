-- ─── Índices para as subconsultas correlacionadas do pipeline e do scoring ─────
--
-- `computeJourneyPipeline` (lib/patientJourney.ts) percorre todos os doentes da
-- clínica com oito EXISTS correlacionados por linha, e `computeTenantScores`
-- (lib/patientScoring.ts) faz o mesmo com dez. Nenhuma das duas pode ser limitada em
-- SQL sem mudar a resposta: as contagens por etapa têm de ser exatas, e o score de um
-- doente só se conhece depois de o calcular, por isso não há por onde cortar antes.
--
-- O que dá mesmo para melhorar é o custo de cada EXISTS. Os índices que existiam eram
-- todos por `patient_id` sozinho, e todas as subconsultas filtram por `patient_id` E
-- mais alguma coisa — `status`, `approved`, `next_due`. Com o índice composto, o
-- Postgres decide o EXISTS dentro do próprio índice em vez de ir à tabela buscar
-- linhas para as deitar fora a seguir.
--
-- Sem alteração de comportamento: um índice não muda nenhuma resposta.

-- treatments: `status IN ('proposed','accepted')`, `= 'completed'`, e
-- `IN ('accepted','completed')` no NOT EXISTS aninhado.
CREATE INDEX IF NOT EXISTS idx_treatments_patient_status ON treatments (patient_id, status);

-- appointments: `appt_date >= CURRENT_DATE AND status <> 'no-show'`. A data vem antes
-- do status na chave porque é ela que corta a maior parte das linhas.
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date_status ON appointments (patient_id, appt_date, status);

-- treatment_plans: `approved = FALSE` e `approved = TRUE`, e ainda o
-- MIN(created_at) dos planos por aprovar.
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_approved ON treatment_plans (patient_id, approved, created_at);

-- recalls: `active = TRUE AND next_due <= CURRENT_DATE`. Parcial, porque os recalls
-- inativos nunca são procurados e não valem o espaço nem o custo de escrita.
CREATE INDEX IF NOT EXISTS idx_recalls_patient_due_active ON recalls (patient_id, next_due) WHERE active = TRUE;

-- patient_tasks: `COUNT(*) ... WHERE status = 'pending'`.
CREATE INDEX IF NOT EXISTS idx_patient_tasks_patient_status ON patient_tasks (patient_id, status);

-- ─── Um índice a mais, que só custava ──────────────────────────────────────────
-- `idx_treatment_plans_pt` e `idx_tp_patient` eram os dois exatamente
-- `(patient_id)` — dois nomes, duas árvores, o mesmo conteúdo. Cada INSERT e cada
-- UPDATE em treatment_plans pagava as duas, e nenhuma consulta ganhava com a
-- segunda. Fica a que o resto do esquema nomeia da mesma maneira (idx_<tabela>_pt).
DROP INDEX IF EXISTS idx_tp_patient;
