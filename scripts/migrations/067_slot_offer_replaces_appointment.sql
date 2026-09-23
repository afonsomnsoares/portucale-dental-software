-- ─── Uma oferta de remarcação sabe que consulta substitui ───────────────────────
-- No degrau de autonomia 'agenda' (migração 062), um doente que pede por SMS para
-- remarcar recebe UM lugar concreto e responde SIM. A oferta não guardava qual era a
-- consulta a remarcar, e por isso aceitar fazia o mesmo que aceitar qualquer outra
-- oferta: INSERT de uma consulta nova. A antiga ficava onde estava — o doente passava a
-- ter duas marcações, e a clínica uma cadeira reservada para alguém que não vem.
--
-- Com esta coluna, lib/waitlist.ts:acceptOfferAndBook MOVE a consulta original (o mesmo
-- UPDATE da rota de reagendamento da receção) em vez de criar outra.
--
-- ON DELETE SET NULL: se a consulta original for cancelada entre a oferta e o SIM, a
-- oferta passa a ser uma marcação simples. O doente queria uma consulta naquele dia; a
-- que tinha já não existe, e recusar-lhe o lugar por isso seria pior.

ALTER TABLE slot_offers
  ADD COLUMN IF NOT EXISTS replaces_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;
