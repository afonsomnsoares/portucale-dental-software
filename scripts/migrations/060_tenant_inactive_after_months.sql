-- ─── O "há quanto tempo é que um doente desapareceu" passa a ser da clínica ──────
-- O limiar de inatividade estava escrito duas vezes no código, em constantes privadas:
-- LIFECYCLE_INACTIVE_MONTHS (lib/lifecycleCalc.ts) e RECOVERY_DEFAULTS.inactiveMonths
-- (lib/recoveryCalc.ts), ambas a 6. O comentário de uma delas pedia à outra que se
-- mantivesse em sincronia — que é a definição de duas verdades à espera de divergirem.
--
-- Seis meses não é um facto sobre medicina dentária: é uma opinião sobre o intervalo
-- normal entre visitas, e esse intervalo muda com o tipo de clínica. Numa clínica de
-- higiene e manutenção, seis meses sem aparecer é exatamente o ciclo normal e ninguém
-- desapareceu; numa de ortodontia, dois meses de silêncio já é um doente perdido. A
-- constante fixa fazia a primeira reativar toda a gente e a segunda não reativar
-- ninguém a tempo.
--
-- Fica em `tenants` e não numa tabela de definições nova pela mesma razão que
-- `operatories` lá está: é uma propriedade da clínica, é um número, e uma tabela com uma
-- coluna é uma junção a mais em todas as leituras.
--
-- O valor por omissão é 6 de propósito — é o que o código fazia até aqui, por isso
-- nenhuma clínica existente vê o comportamento mudar ao aplicar esta migração.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inactive_after_months INTEGER NOT NULL DEFAULT 6;

-- Os limites existem porque os dois extremos partem coisas silenciosamente: a zero, todos
-- os doentes ficam permanentemente 'inactive' e a reativação dispara sobre a clínica
-- inteira; acima de cinco anos, a coorte de inativos fica vazia e o ecrã de recuperação
-- passa a dizer que não há nada a recuperar. Nenhum dos dois dá erro — é precisamente
-- por isso que o travão tem de estar na base de dados e não só no formulário.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_inactive_after_months_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_inactive_after_months_check
      CHECK (inactive_after_months BETWEEN 1 AND 60);
  END IF;
END $$;
