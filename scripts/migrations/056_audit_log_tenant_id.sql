-- ─── audit_log passa a ser isolado por tenant_id, e não por um nome escrito à mão ──
--
-- O que estava mal
-- ----------------
-- O `audit_log` não tinha `tenant_id`. A migração 011 documenta-o como "não coberto"
-- por RLS justamente por isso, e o único isolamento vivia em app/api/audit/route.ts:
--
--     const clinic = tenantId ? user.clinic : searchParams.get('clinic');
--     sql += ` AND clinic=$N`;
--
-- `user.clinic` é um campo de texto livre, escrito num <input> na gestão de
-- utilizadores. Vem por omissão a 'Main' no cliente e 'Main Clinic' no servidor, nunca
-- é confrontado com a tabela `tenants`, e o `revalidateSession` não o volta a
-- sincronizar (só sincroniza `role` e `tenant_id`). Consequências, as duas reais:
--
--   • Duas clínicas que aceitem o nome por omissão leem o registo uma da outra sem
--     que ninguém ataque nada. As linhas trazem nomes de doentes, medicamentos
--     prescritos e emails de pessoal — «Prescription: <medicamento>», «Patient — <nome>».
--   • Um admin de clínica podia pôr no seu próprio `clinic` o nome da clínica do lado
--     e passar a ler — e a ESCREVER — no registo dela. As linhas forjadas entravam na
--     cadeia de hash da 015 como legítimas.
--
-- O que esta migração faz
-- -----------------------
-- Dá ao `audit_log` a mesma chave que todas as outras tabelas já usam, e mete-o
-- debaixo de RLS. O `clinic` fica como está — é o nome que se mostra, e continua a ser
-- útil para ler o registo — mas deixa de decidir quem vê o quê.
--
-- Porquê duas políticas em vez da `tenant_isolation` genérica
-- ----------------------------------------------------------
-- Nem toda a linha tem clínica. `logBlockedAccess()` (lib/audit.ts) regista tentativas
-- recusadas, e as mais interessantes são precisamente as que ainda não têm sessão: um
-- pedido anónimo não tem `app.tenant_id` posto. Com a política genérica (o mesmo
-- predicado no USING e no WITH CHECK), esse INSERT passava a ser recusado e o produto
-- deixava de registar exatamente as tentativas que o registo existe para apanhar.
--
-- Por isso a leitura e a escrita separam-se:
--   • ler   — só as linhas da própria clínica (NULL fica invisível a quem não é
--             super-admin, que é o que se quer: as linhas de plataforma são dele).
--   • escrever — a própria clínica, ou sem clínica nenhuma; nunca a de outra pessoa.
-- O append-only continua a vir do REVOKE UPDATE, DELETE da 011 e do trigger da 015.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

-- Recuperar o que dá para recuperar: onde o nome bate certo com uma clínica, e bate
-- certo com UMA só, o histórico fica atribuído. O resto fica a NULL — visível apenas
-- ao super-admin, que é o lado seguro de errar. Não se inventa dono para uma linha de
-- auditoria.
UPDATE audit_log a
   SET tenant_id = t.id
  FROM tenants t
 WHERE a.tenant_id IS NULL
   AND a.clinic = t.name
   AND (SELECT COUNT(*) FROM tenants t2 WHERE t2.name = a.clinic) = 1;

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log (tenant_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'tenant_isolation_read'
  ) THEN
    CREATE POLICY tenant_isolation_read ON audit_log
      FOR SELECT
      USING (current_setting('app.is_super_admin', true) = 'true'
             OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'tenant_isolation_append'
  ) THEN
    CREATE POLICY tenant_isolation_append ON audit_log
      FOR INSERT
      WITH CHECK (current_setting('app.is_super_admin', true) = 'true'
                  OR tenant_id IS NULL
                  OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── A view de cobertura tem de conhecer a divisão acima ────────────────────
-- `tenant_tables_without_rls` (migração 033) procurava uma política chamada
-- exatamente `tenant_isolation`. O audit_log tem duas, por a leitura e a escrita
-- precisarem de predicados diferentes — sem isto, a tabela que esta migração acabou
-- de proteger aparecia na view como desprotegida, e test/integration/rls-coverage
-- falhava a dizer o contrário do que é verdade.
--
-- Redefinida aqui E em scripts/schema.sql, com o mesmo texto: é precisamente a
-- divergência entre as duas que a segunda asserção desse teste existe para apanhar.
CREATE OR REPLACE VIEW tenant_tables_without_rls AS
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = c.relname AND policyname LIKE 'tenant_isolation%'
  )
ORDER BY c.relname;
