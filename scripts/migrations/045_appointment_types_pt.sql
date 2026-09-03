-- ─── TIPOS DE CONSULTA EM PT-PT ────────────────────────────────────────────
-- O catálogo de APPOINTMENT_TYPES (lib/constants.ts) estava em inglês, e os
-- seus rótulos são gravados literalmente: `appointments.type` é texto livre
-- sem FK (ver app/api/appointments/route.ts, que grava `type` tal como vem) e
-- `procedure_item_usage.appointment_type` é a chave por onde a previsão de
-- consumo liga um procedimento aos itens que gasta.
--
-- Traduzir o catálogo sem reescrever estas duas colunas deixaria as linhas
-- antigas fora dele: uma consulta com type='Root Canal' deixa de encontrar
-- entrada em getAppointmentTypeOption() e perde os requisitos de equipamento
-- que o otimizador de agenda usa, e um mapeamento de consumo com
-- appointment_type='Root Canal' deixa de ser encontrado por nenhuma consulta.
-- Nenhum dos dois casos dá erro — falham em silêncio, que é a razão de isto
-- ser uma migração e não uma nota no README.
--
-- Só se reescrevem os valores que vieram do catálogo. `type` sempre aceitou
-- texto escrito à mão pela receção, e esse não se toca.

UPDATE appointments SET type = v.pt
FROM (VALUES
  ('Comprehensive Exam',        'Consulta de Avaliação'),
  ('Hygiene Cleaning',          'Destartarização'),
  ('X-Ray Review',              'Avaliação Radiográfica'),
  ('Root Canal',                'Endodontia'),
  ('Crown Preparation',         'Preparação de Coroa'),
  ('Extraction',                'Extração'),
  ('Whitening',                 'Branqueamento'),
  ('Implant Consultation',      'Consulta de Implantologia'),
  ('Full Mouth Rehabilitation', 'Reabilitação Oral Completa'),
  ('Orthodontic Consult',       'Consulta de Ortodontia')
) AS v(en, pt)
WHERE appointments.type = v.en;

UPDATE procedure_item_usage SET appointment_type = v.pt
FROM (VALUES
  ('Comprehensive Exam',        'Consulta de Avaliação'),
  ('Hygiene Cleaning',          'Destartarização'),
  ('X-Ray Review',              'Avaliação Radiográfica'),
  ('Root Canal',                'Endodontia'),
  ('Crown Preparation',         'Preparação de Coroa'),
  ('Extraction',                'Extração'),
  ('Whitening',                 'Branqueamento'),
  ('Implant Consultation',      'Consulta de Implantologia'),
  ('Full Mouth Rehabilitation', 'Reabilitação Oral Completa'),
  ('Orthodontic Consult',       'Consulta de Ortodontia')
) AS v(en, pt)
WHERE procedure_item_usage.appointment_type = v.en;

-- A lista de espera guarda o tipo pretendido pelo doente na mesma convenção
-- (lib/waitlistMatch.ts compara `treatment_type` com `appointments.type`), por
-- isso segue o mesmo destino — senão um candidato deixava de casar com a vaga
-- exatamente do procedimento que pediu.
UPDATE waitlist_entries SET treatment_type = v.pt
FROM (VALUES
  ('Comprehensive Exam',        'Consulta de Avaliação'),
  ('Hygiene Cleaning',          'Destartarização'),
  ('X-Ray Review',              'Avaliação Radiográfica'),
  ('Root Canal',                'Endodontia'),
  ('Crown Preparation',         'Preparação de Coroa'),
  ('Extraction',                'Extração'),
  ('Whitening',                 'Branqueamento'),
  ('Implant Consultation',      'Consulta de Implantologia'),
  ('Full Mouth Rehabilitation', 'Reabilitação Oral Completa'),
  ('Orthodontic Consult',       'Consulta de Ortodontia')
) AS v(en, pt)
WHERE waitlist_entries.treatment_type = v.en;
