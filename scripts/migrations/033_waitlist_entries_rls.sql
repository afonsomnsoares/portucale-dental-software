-- ─── HARDENING: RLS em falta na waitlist_entries ──────────────────────────
-- A única tabela com `tenant_id` que ficou de fora do isolamento ao nível da
-- base de dados. Não foi uma decisão — foi uma linha que caiu de uma lista:
-- o comentário em scripts/schema.sql (secção RLS, ~linha 579) diz que
-- 011_row_level_security.sql cobre "those six" tabelas criadas pelas
-- migrações e nomeia appointment_cancellations, waitlist_entries,
-- slot_offers, patient_lifecycle_state, recall_schedule e recovery_snapshots.
-- O array do 011 tem cinco: waitlist_entries não está lá.
--
-- O efeito era assimétrico e por isso difícil de notar: slot_offers (a filha)
-- estava protegida, waitlist_entries (a mãe) não. Uma query que falhasse o
-- filtro por tenant sobre waitlist_entries devolvia inscrições de outras
-- clínicas — nome do doente incluído, via o JOIN que lib/waitlist.ts faz — sem
-- que a rede de segurança do Postgres a apanhasse.
--
-- Mesma política textual de todas as outras tabelas do 011, para não haver
-- duas variantes a manter. Idempotente pelo teste a pg_policies, como o 032.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'waitlist_entries' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE waitlist_entries FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON waitlist_entries
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Rede de aviso para a próxima vez ─────────────────────────────────────
-- O problema acima não foi a política em falta, foi ninguém ter dado por ela
-- durante 22 migrações. Esta view lista qualquer tabela com coluna `tenant_id`
-- sem política `tenant_isolation` — hoje devolve zero linhas, e uma tabela
-- nova que nasça sem RLS aparece aqui imediatamente.
--
-- Só uma view: não impõe nada e não pode partir uma migração futura. Serve
-- para ser consultada (`SELECT * FROM tenant_tables_without_rls;`) no fim de
-- cada migração que crie tabelas.
CREATE OR REPLACE VIEW tenant_tables_without_rls AS
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'tenant_isolation'
  )
ORDER BY c.relname;
