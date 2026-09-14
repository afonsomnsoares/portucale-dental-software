#!/bin/sh
# Cópia de segurança da base de dados. Corrido em ciclo pelo serviço `backup` do
# docker-compose.yml, ou à mão em qualquer máquina com psql/pg_dump e as variáveis
# PG* definidas.
#
# ─── O que isto protege, e o que NÃO protege ────────────────────────────────
# Protege de: "apaguei a tabela errada", "a migração correu mal", "o doente pediu
# o apagamento e foi a mais". Recupera-se em minutos com scripts/restore.sh.
#
# NÃO protege de o servidor se perder. Os ficheiros ficam no mesmo disco da base de
# dados a menos que BACKUP_DIR aponte para outro sítio, e nenhum backup local
# sobrevive a um incêndio, a um roubo ou a um provedor a apagar a instância. Para um
# produto que guarda processos clínicos falta o passo de fora, e esse passo é uma
# decisão de quem administra, não deste ficheiro:
#
#   rclone sync /caminho/dos/backups remoto:portucale-backups   # ou rsync, ou o
#                                                               # que a clínica já usa
#
# ─── Formato ────────────────────────────────────────────────────────────────
# `pg_dump -Fc` (custom, já comprimido) e não SQL simples, por duas razões: o
# pg_restore consegue restaurar tabelas isoladas a partir dele — que é o que se quer
# quando o problema foi UMA tabela e não a base toda — e é mais pequeno.
#
# ─── Uma cópia que não se sabe ler não é uma cópia ──────────────────────────
# Toda a gente escreve o pg_dump. O passo que quase ninguém escreve é o de seguida:
# confirmar que o ficheiro se abre. Um dump truncado (disco cheio a meio, processo
# morto pelo OOM) tem tamanho, data e um nome perfeitamente tranquilizador. Por isso
# cada ficheiro é verificado com `pg_restore --list` e, se não passar, é marcado
# .CORRUPTO e o script sai com erro em vez de o contar como sucesso.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB="${PGDATABASE:-portucale_dental}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${DB}-${STAMP}.dump"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

mkdir -p "$BACKUP_DIR"

# Escreve-se primeiro para .parcial e só depois se muda o nome. Sem isto, um
# processo morto a meio deixava para trás um ficheiro com o nome definitivo —
# indistinguível de uma cópia boa na listagem, e a retenção lá em baixo acabaria
# por apagar as boas por ser mais nova do que elas.
log "a copiar ${DB} para ${OUT}"
if ! pg_dump --format=custom --no-owner --no-privileges --file="${OUT}.parcial" "$DB"; then
	log "ERRO: o pg_dump falhou; nada foi gravado"
	rm -f "${OUT}.parcial"
	exit 1
fi

# Verificação de integridade: o índice do dump tem de se ler até ao fim.
if ! pg_restore --list "${OUT}.parcial" > /dev/null 2>&1; then
	log "ERRO: o ficheiro não passa o pg_restore --list — dump corrompido ou truncado"
	mv "${OUT}.parcial" "${OUT}.CORRUPTO"
	exit 1
fi

mv "${OUT}.parcial" "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
TABELAS="$(pg_restore --list "$OUT" | grep -c 'TABLE DATA' || true)"
log "OK — ${OUT} (${SIZE}, ${TABELAS} tabelas com dados)"

# ─── Retenção ───────────────────────────────────────────────────────────────
# Só apaga o que verificou estar bom. Um .CORRUPTO fica de propósito: é a prova de
# que houve um problema, e apagá-lo silenciosamente deixava a pasta a parecer
# saudável. Os .parcial de execuções mortas a meio, esses vão-se embora.
if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
	find "$BACKUP_DIR" -maxdepth 1 -name "${DB}-*.dump" -type f -mtime "+${KEEP_DAYS}" -print -delete \
		| sed 's/^/[backup] apagado por retenção: /' || true
	find "$BACKUP_DIR" -maxdepth 1 -name '*.parcial' -type f -mtime +1 -delete || true
fi

RESTANTES="$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB}-*.dump" -type f | wc -l | tr -d ' ')"
CORRUPTOS="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.CORRUPTO' -type f | wc -l | tr -d ' ')"
log "${RESTANTES} cópia(s) em ${BACKUP_DIR}, retenção ${KEEP_DAYS} dia(s)"
[ "$CORRUPTOS" -gt 0 ] && log "ATENÇÃO: ${CORRUPTOS} ficheiro(s) .CORRUPTO nesta pasta — investigar"

exit 0
