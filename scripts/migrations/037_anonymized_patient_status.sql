-- ─── Estado 'anonymized' para pacientes ──────────────────────────────────────
-- O direito ao apagamento (RGPD art. 17.º) não se cumpre aqui com um DELETE: o
-- processo clínico e os documentos fiscais têm obrigações de conservação que se
-- lhe sobrepõem (art. 17.º, n.º 3, al. b). O que se apaga é a ligação a uma
-- pessoa identificável — a linha de `patients` fica como âncora das chaves
-- estrangeiras, esvaziada de tudo o que identifica.
--
-- Isso precisa de um estado próprio. Sem ele, a linha anonimizada fica indistinguível
-- de um paciente 'registered' que nunca voltou: apareceria nas listas da receção,
-- nas campanhas de reativação e nas contagens de pacientes ativos. O CHECK da
-- migração 010 não previa este caso porque o apagamento ainda não estava
-- implementado (ver lib/dataSubject.ts).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_status_check') THEN
    ALTER TABLE patients DROP CONSTRAINT patients_status_check;
  END IF;
  ALTER TABLE patients ADD CONSTRAINT patients_status_check
    CHECK (status IN ('registered','waiting','in-operatory','ready-dismissal','departed','anonymized'));
END $$;
