-- ─── Reconciliar as bases antigas com a forma que o código realmente usa ────────
--
-- O problema
-- ----------
-- Oito tabelas são criadas nos dois sítios: em scripts/schema.sql e outra vez numa
-- migração, sempre com `CREATE TABLE IF NOT EXISTS`. E `scripts/migrate.ts` aplica o
-- schema.sql primeiro numa base vazia (`ensureBaseSchema`). Resultado: numa instalação
-- de raiz é o schema.sql que ganha e a migração 001 não faz nada — mas fica à mesma
-- registada em `schema_migrations` como aplicada. Numa base anterior a essas tabelas
-- terem entrado no schema.sql, ganhou a migração. As duas bases dizem-se igualmente
-- «migradas» e têm colunas diferentes.
--
-- Das oito, três são afinal idênticas (`ai_calls`, `leads`, `rate_limit_counters`).
-- As que divergem a sério:
--
--   lab_orders      raiz: created_at, created_by   migrada: ordered_at, ordered_by
--   prescriptions   raiz: created_at, created_by   migrada: prescribed_at, prescribed_by
--   medical_history raiz: created_at, allergies TEXT, pregnancy TEXT
--                   migrada: sem created_at, allergies JSONB, pregnancy BOOLEAN
--
-- O código está escrito todo contra a forma de raiz — `app/api/lab-orders/route.ts`
-- faz `ORDER BY l.created_at`, `app/api/prescriptions/route.ts` lê `p.created_at` e
-- escreve `created_by`. Numa clínica com a base antiga, a página de Laboratório
-- responde 42703 (undefined column) e a anamnese tenta escrever '' numa coluna JSONB
-- (22P02). Nada detetava a diferença, porque `schema_migrations` dizia que estava tudo
-- em dia nas duas.
--
-- O que esta migração faz
-- -----------------------
-- Leva a base antiga à forma de raiz, sem perder dados: onde a coluna existe com o
-- nome antigo, é RENOMEADA (os valores seguem); onde não existe de todo, é criada.
-- Numa instalação de raiz, todos os blocos abaixo não fazem nada — é para isso que
-- cada um pergunta primeiro ao information_schema.
--
-- As colunas que só existem do lado migrado e que o código nunca toca
-- (`consent_forms.content_type/signed_at/status`, `lab_orders.tracking_url`,
-- `treatment_plans.signature_url`) ficam onde estão: apagá-las destruiria o que lá
-- estiver escrito para ganhar só simetria. A divergência que fazia mal era a das
-- colunas que o código lê, e é essa que desaparece aqui.
-- A guarda contra a repetição está em test/integration/schema-parity.test.ts.

-- ─── lab_orders: ordered_at/ordered_by → created_at/created_by ─────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='lab_orders' AND column_name='ordered_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='lab_orders' AND column_name='created_at') THEN
    ALTER TABLE lab_orders RENAME COLUMN ordered_at TO created_at;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='lab_orders' AND column_name='ordered_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='lab_orders' AND column_name='created_by') THEN
    ALTER TABLE lab_orders RENAME COLUMN ordered_by TO created_by;
  END IF;
END $$;

ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ─── prescriptions: prescribed_at/prescribed_by → created_at/created_by ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='prescriptions' AND column_name='prescribed_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='prescriptions' AND column_name='created_at') THEN
    ALTER TABLE prescriptions RENAME COLUMN prescribed_at TO created_at;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='prescriptions' AND column_name='prescribed_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='prescriptions' AND column_name='created_by') THEN
    ALTER TABLE prescriptions RENAME COLUMN prescribed_by TO created_by;
  END IF;
END $$;

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ─── medical_history: created_at, e os tipos das colunas de texto ─────────────
ALTER TABLE medical_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- `allergies` era JSONB do lado migrado. A rota escreve `allergies || ''` — uma string
-- vazia, que não é JSON válido (22P02). O conteúdo real é prosa escrita por um
-- dentista, não uma estrutura, por isso TEXT é a forma certa e a conversão não perde
-- nada: #>>'{}' devolve o texto de um escalar JSON, e o ::text cobre o resto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='medical_history'
                AND column_name='allergies' AND data_type='jsonb') THEN
    ALTER TABLE medical_history
      ALTER COLUMN allergies TYPE TEXT
      USING COALESCE(CASE WHEN jsonb_typeof(allergies) = 'string' THEN allergies #>> '{}'
                          ELSE allergies::text END, '');
    ALTER TABLE medical_history ALTER COLUMN allergies SET DEFAULT '';
  END IF;

  -- `pregnancy` era BOOLEAN. O formulário tem três respostas possíveis — sim, não,
  -- não aplicável — e um booleano não tem onde pôr a terceira.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='medical_history'
                AND column_name='pregnancy' AND data_type='boolean') THEN
    ALTER TABLE medical_history
      ALTER COLUMN pregnancy TYPE TEXT
      USING CASE WHEN pregnancy IS TRUE THEN 'Sim'
                 WHEN pregnancy IS FALSE THEN 'Não'
                 ELSE '' END;
    ALTER TABLE medical_history ALTER COLUMN pregnancy SET DEFAULT '';
  END IF;
END $$;

-- ─── consent_forms: só garantir o que o código lê ─────────────────────────────
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
