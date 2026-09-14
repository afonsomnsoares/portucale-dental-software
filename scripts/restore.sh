#!/bin/sh
# Restauro de uma cópia feita por scripts/backup.sh.
#
#   sh scripts/restore.sh <ficheiro.dump> <base_de_dados_destino>
#
# ─── ISTO APAGA A BASE DE DADOS DE DESTINO ──────────────────────────────────
# Recria o schema `public` do zero antes de restaurar, porque um restauro por cima
# de dados existentes deixa uma mistura das duas versões — o pior estado possível,
# e o mais difícil de detetar depois. Por isso exige confirmação explícita:
#
#   PORTUCALE_RESTORE_CONFIRMO=1 sh scripts/restore.sh copia.dump portucale_dental
#
# Sem essa variável, o script lista o que faria e sai sem tocar em nada.
#
# ─── O ensaio que dá valor a tudo isto ──────────────────────────────────────
# Uma cópia de segurança nunca testada é uma hipótese, não uma garantia. O ensaio
# não toca na produção: restaura-se para uma base NOVA e comparam-se as contagens.
#
#   createdb portucale_ensaio
#   PORTUCALE_RESTORE_CONFIRMO=1 sh scripts/restore.sh a_ultima_copia.dump portucale_ensaio
#   # compara com a produção:
#   psql -d portucale_dental -tAc "SELECT count(*) FROM patients"
#   psql -d portucale_ensaio  -tAc "SELECT count(*) FROM patients"
#   dropdb portucale_ensaio
#
# Vale a pena repeti-lo de tempo a tempo, e obrigatoriamente depois de mudar a
# versão do Postgres: é a mudança que quebra restauros, e quebra-os em silêncio.
#
# ─── O que o dump NÃO traz ──────────────────────────────────────────────────
# O backup.sh grava com --no-owner --no-privileges, para o dump poder ser restaurado
# por um utilizador diferente do que o criou. Consequência: os GRANTs e o papel
# `portucale_app` não vêm no ficheiro. Numa base restaurada de raiz, correr
# `npm run db:migrate` depois do restauro repõe as políticas de RLS e as permissões
# da migração 011 — sem isso, a app liga-se e não vê nada (fail-closed, como deve).
set -eu

DUMP="${1:-}"
TARGET="${2:-}"

if [ -z "$DUMP" ] || [ -z "$TARGET" ]; then
	echo "uso: sh scripts/restore.sh <ficheiro.dump> <base_de_dados_destino>" >&2
	exit 2
fi
if [ ! -f "$DUMP" ]; then
	echo "erro: não encontro o ficheiro '$DUMP'" >&2
	exit 2
fi

# Verifica-se o ficheiro ANTES de destruir o destino. Descobrir que a cópia não se
# lê depois de apagar a base a que ela se destinava é a pior ordem possível.
if ! pg_restore --list "$DUMP" > /dev/null 2>&1; then
	echo "erro: '$DUMP' não é um dump legível (pg_restore --list falhou). Nada foi tocado." >&2
	exit 1
fi

TABELAS="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
echo "cópia:   $DUMP"
echo "destino: $TARGET"
echo "conteúdo: ${TABELAS} tabelas com dados"

if [ "${PORTUCALE_RESTORE_CONFIRMO:-}" != "1" ]; then
	cat <<'AVISO'

Nada foi alterado.

Isto APAGA o schema `public` da base de dados de destino e substitui-o pelo
conteúdo da cópia. Para executar de verdade:

  PORTUCALE_RESTORE_CONFIRMO=1 sh scripts/restore.sh <ficheiro.dump> <destino>

AVISO
	exit 0
fi

echo "[restore] a recriar o schema public em ${TARGET}…"
psql -d "$TARGET" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

# --exit-on-error: sem isto o pg_restore acumula erros, continua até ao fim e
# devolve 0 — uma base meio restaurada apresentada como sucesso.
echo "[restore] a restaurar…"
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error "$DUMP"

# Contagens EXATAS e não o n_live_tup de pg_stat_user_tables. O n_live_tup é uma
# estimativa mantida pelo coletor de estatísticas: numa base acabada de restaurar,
# antes de o autovacuum passar, pode vir a zero ou desatualizado sem nada o indicar.
# Num ecrã cujo único propósito é responder a «o restauro trouxe tudo?», um número
# aproximado não serve — e é indistinguível de um exato quando calha acertar.
# O query_to_xml é o que permite contar de verdade em todas as tabelas de uma vez.
echo "[restore] concluído. Contagens EXATAS no destino (15 maiores):"
psql -d "$TARGET" -tAc "
  SELECT '  ' || relname || ': ' || n FROM (
    SELECT relname,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname),
                               false, true, '')))[1]::text::bigint AS n
      FROM pg_stat_user_tables
     WHERE schemaname = 'public'
  ) t WHERE n > 0 ORDER BY n DESC LIMIT 15"

echo "[restore] total: $(psql -d "$TARGET" -tAc "
  SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'") tabelas restauradas"

cat <<'NOTA'

Falta um passo se esta base foi criada de raiz: o dump não traz GRANTs nem o papel
portucale_app (--no-owner --no-privileges). Corre as migrações para repor a RLS e as
permissões, senão a aplicação liga-se e não vê nada:

  npm run db:migrate

NOTA
