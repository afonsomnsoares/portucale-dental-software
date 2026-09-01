-- ─── GESTÃO DO PACIENTE: documentos — categorizar e ligar a um pedido ─────
-- `uploads` já existe e já está ligado a `patient_id`; falta apenas saber
-- QUE TIPO de documento é (para o poder organizar por categoria) e, quando
-- o upload resolve um pedido explícito da equipa (`patient_tasks` do tipo
-- 'document_request', ver 018_patient_tasks.sql), a que pedido corresponde
-- — para a UI poder fechar esse pedido sozinha assim que o ficheiro chega.
-- uploads já está coberto por RLS (tabela já presente no array de
-- scripts/migrations/011_row_level_security.sql), por isso esta migração é
-- só ALTER TABLE.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'
  CHECK (category IN ('id_document', 'xray', 'consent', 'insurance', 'lab_result', 'other'));
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES patient_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uploads_patient_category ON uploads(patient_id, category);
