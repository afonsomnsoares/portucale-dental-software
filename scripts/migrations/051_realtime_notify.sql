-- ─── TEMPO REAL: DO SNAPSHOT AO PUSH ────────────────────────────────────────
-- O canal SSE (app/api/sse/route.ts) existia desde a migração anterior a esta e o
-- comentário no topo dele era honesto: «a extensão para push em tempo real é uma adição
-- trivial porque o formato do stream já está definido». Era e não era. O formato estava
-- definido; o que faltava era a FONTE — o endpoint aceitava a ligação, mandava um
-- retrato do estado atual e depois passava o resto da vida a mandar heartbeats. Uma
-- página ligada a ele ficava tão desatualizada como uma página sem ele, só que com uma
-- ligação aberta a fingir o contrário. Nenhuma página estava ligada, o que era, no
-- fundo, a única coisa que impedia isso de ser um bug visível.
--
-- ─── Porquê LISTEN/NOTIFY e não polling ─────────────────────────────────────
-- A alternativa óbvia era o endpoint consultar a base de dados de dois em dois segundos
-- e mandar o que mudou. Funciona, e transforma cada separador aberto numa clínica em
-- 30 consultas por minuto — uma receção com quatro ecrãs abertos passa a bater na base
-- de dados 2 000 vezes por hora para descobrir, quase sempre, que nada mudou.
--
-- O Postgres já sabe fazer isto: NOTIFY publica, LISTEN subscreve, e a mensagem só
-- viaja quando alguma coisa acontece de facto. Não precisa de Redis, não precisa de
-- dependências novas, e funciona entre instâncias — que é justamente onde o SSE
-- ingénuo falharia num deploy com mais do que um processo.
--
-- ─── O que vai no payload, e o que não vai ──────────────────────────────────
-- O NOTIFY do Postgres tem um limite de 8000 bytes e — mais importante — o payload
-- viaja para todos os subscritores do canal, incluindo os de outras clínicas. Por isso
-- leva o MÍNIMO: tenant_id (para o endpoint filtrar), a tabela, o id da linha e o
-- estado novo. Nada de nomes, nada de dados do doente. Quem receber a notificação e
-- quiser saber mais vai buscá-lo pela API normal, com a sessão dele e com a RLS a
-- valer — que é o oposto de mandar dados clínicos por um canal que não sabe quem está
-- à escuta.

CREATE OR REPLACE FUNCTION notify_realtime() RETURNS trigger AS $$
DECLARE
  row_tenant UUID;
  payload TEXT;
BEGIN
  row_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF row_tenant IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  payload := json_build_object(
    'tenantId', row_tenant,
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', COALESCE(NEW.id, OLD.id),
    -- `status` só existe em algumas das tabelas subscritas; to_jsonb evita ter de
    -- escrever um trigger por tabela só por causa de uma coluna.
    'status', to_jsonb(COALESCE(NEW, OLD)) ->> 'status'
  )::text;

  -- Um canal só, com o tenant dentro do payload, em vez de um canal por clínica: o
  -- LISTEN não aceita nome dinâmico sem SQL construído à mão, e um canal por clínica
  -- obrigaria cada ligação SSE a re-executar LISTEN quando o super-admin entra noutra.
  -- O endpoint filtra, e o payload não tem nada que não se possa ver.
  PERFORM pg_notify('portucale_realtime', payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- As tabelas que uma pessoa está a olhar para um ecrã quer ver mudar sozinhas: a agenda
-- do dia, a sala de espera, as tarefas, e as conversas que entram (migração 049).
-- Deliberadamente NÃO inclui tabelas de escrita massiva (audit_log, patient_timeline,
-- inventory_movements): um NOTIFY por linha durante uma importação de doentes inundaria
-- todos os separadores abertos com eventos que ninguém está a ver.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['appointments', 'patient_tasks', 'notifications', 'conversations', 'incidents'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=tbl) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_notify_realtime ON %I', tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_notify_realtime AFTER INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION notify_realtime()',
        tbl
      );
    END IF;
  END LOOP;
END $$;
