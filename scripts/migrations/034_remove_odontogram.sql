-- ─── REMOÇÃO DO ODONTOGRAMA ────────────────────────────────────────────────
-- Remove o odontograma 2D e toda a noção de "dente" do modelo de dados, na
-- sequência do 3D removido em 5021da6. Decisão de produto, tomada com o custo
-- conhecido: um tratamento deixa de poder indicar a que dente se aplica.
--
-- O que sai:
--   teeth              — o registo por dente de cada doente (condição,
--                        superfícies, notas). É a única tabela desta migração
--                        que continha dados clínicos por doente.
--   tooth_conditions   — o catálogo de condições (cárie, coroa, implante...)
--                        que só o odontograma lia, servido por /api/settings.
--   treatments.tooth_num  — o dente a que o tratamento se aplicava.
--   lab_orders.tooth_nums — os dentes de uma encomenda de laboratório.
--
-- DROP TABLE leva atrás os índices, os triggers de updated_at (instalados pelo
-- 016 por nome de tabela) e a restrição UNIQUE(patient_id, tooth_num); não é
-- preciso removê-los à mão. Nenhuma das duas tabelas tinha política de RLS
-- — teeth não tem tenant_id, e é isso que o comentário do 011 explica.
--
-- IRREVERSÍVEL: os dados vão-se. Quem precise de os guardar faz o dump destas
-- duas tabelas e das duas colunas ANTES de correr esta migração.

DROP TABLE IF EXISTS teeth;
DROP TABLE IF EXISTS tooth_conditions;

ALTER TABLE treatments DROP COLUMN IF EXISTS tooth_num;
ALTER TABLE lab_orders DROP COLUMN IF EXISTS tooth_nums;
