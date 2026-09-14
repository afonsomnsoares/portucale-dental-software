#!/bin/sh
# Envia para fora da máquina as cópias que scripts/backup.sh deixou em BACKUP_DIR.
#
#   sh scripts/backup-offsite.sh
#
# ─── Porque é um ficheiro à parte ───────────────────────────────────────────
# O backup.sh protege de "apaguei a tabela errada". Isto protege de perder o
# servidor — incêndio, roubo, o provedor a apagar a instância, ransomware a cifrar
# o disco onde os dumps também estão. São riscos diferentes e o segundo é o que
# acaba com uma clínica; nenhuma cópia que viva no mesmo disco da base de dados o
# cobre, por muitas que sejam.
#
# ─── UM DUMP QUE SAI DA MÁQUINA VAI CIFRADO ────────────────────────────────
# O ficheiro é a base de dados inteira: processos clínicos, contactos, hashes de
# password. Mandá-lo em claro para o armazenamento de um terceiro é uma
# transferência de dados de saúde para um subcontratante — e se o balde ficar
# exposto, o que se perde é tudo de uma vez, sem nada a mitigar.
#
# Por isso este script RECUSA-SE a enviar sem cifra, e há duas formas de a ter:
#
#   A) Remoto `crypt` do rclone (recomendado — o rclone cifra antes de sair):
#        rclone config           # cria, por exemplo, "b2-portucale"
#        rclone config           # cria "portucale-cifrado" do tipo crypt,
#                                # com remote = b2-portucale:portucale-backups
#        OFFSITE_REMOTE=portucale-cifrado:  OFFSITE_CIFRA=rclone
#
#   B) GPG simétrico, antes de o rclone tocar no ficheiro:
#        OFFSITE_REMOTE=b2-portucale:portucale-backups
#        OFFSITE_CIFRA=gpg  OFFSITE_GPG_PASSPHRASE_FILE=/caminho/para/a/frase
#
# GUARDA A CHAVE FORA DAQUI. Uma cópia cifrada com uma chave que só existe no
# servidor que se perdeu é uma cópia que não se abre — é o modo de falha clássico
# deste passo, e transforma meses de backups em ruído.
#
# ─── `copy` e não `sync`, de propósito ─────────────────────────────────────
# O `sync` faria o remoto espelhar o local: quando a retenção do backup.sh apagasse
# um dump com 15 dias, o `sync` apagava-o também lá — e o offsite passava a ter a
# mesma janela curta do disco local, que é precisamente o que não se quer. Com
# `copy` só se acrescenta; a retenção longa faz-se com as regras de ciclo de vida
# do balde (e essas o servidor comprometido não controla, o que é o ponto).
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
REMOTE="${OFFSITE_REMOTE:-}"
CIFRA="${OFFSITE_CIFRA:-}"

log() { echo "[offsite] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [ -z "$REMOTE" ]; then
	cat >&2 <<'AJUDA'
[offsite] OFFSITE_REMOTE não está definido — nada foi enviado.

Define o destino (um remoto do rclone) e o modo de cifra. Ver o cabeçalho deste
ficheiro para as duas opções:

  OFFSITE_REMOTE=portucale-cifrado:  OFFSITE_CIFRA=rclone  sh scripts/backup-offsite.sh

AJUDA
	exit 2
fi

if ! command -v rclone > /dev/null 2>&1; then
	log "ERRO: o rclone não está instalado (apt install rclone, ou https://rclone.org/install/)"
	exit 1
fi

# Fail-closed: sem cifra declarada não sai nada. A variável de escape existe para
# quem tenha a cifra noutra camada (um balde com cifra do lado do servidor gerida
# pela própria clínica, por exemplo) e queira assumir essa decisão em claro.
if [ -z "$CIFRA" ]; then
	if [ "${OFFSITE_ACEITO_SEM_CIFRA:-}" = "1" ]; then
		log "AVISO: a enviar SEM cifra por decisão explícita (OFFSITE_ACEITO_SEM_CIFRA=1)"
	else
		log "ERRO: OFFSITE_CIFRA não definido (rclone|gpg). Um dump é a base de dados inteira; não sai em claro."
		log "      Se a cifra está noutra camada e assumes essa decisão: OFFSITE_ACEITO_SEM_CIFRA=1"
		exit 1
	fi
fi

# Só o que backup.sh verificou. Os .parcial (execuções mortas a meio) e os
# .CORRUPTO (dumps que não passaram o pg_restore --list) ficam de propósito: enviar
# um ficheiro ilegível para fora só consome banda e dá uma falsa sensação de cópia.
FICHEIROS="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f | wc -l | tr -d ' ')"
if [ "$FICHEIROS" -eq 0 ]; then
	log "ERRO: não há nenhum .dump verificado em ${BACKUP_DIR} — o backup.sh já correu?"
	exit 1
fi
log "${FICHEIROS} cópia(s) verificada(s) em ${BACKUP_DIR}"

case "$CIFRA" in
gpg)
	PASSFILE="${OFFSITE_GPG_PASSPHRASE_FILE:-}"
	if [ -z "$PASSFILE" ] || [ ! -f "$PASSFILE" ]; then
		log "ERRO: OFFSITE_CIFRA=gpg exige OFFSITE_GPG_PASSPHRASE_FILE a apontar para um ficheiro legível"
		exit 1
	fi
	command -v gpg > /dev/null 2>&1 || {
		log "ERRO: o gpg não está instalado"
		exit 1
	}
	# Cifra-se para um diretório próprio e envia-se esse. Cifrar em cima do original
	# arriscava deixar o dump em claro meio-apagado se o processo morresse a meio.
	CIFRADOS="${BACKUP_DIR}/.cifrados"
	mkdir -p "$CIFRADOS"
	for f in "$BACKUP_DIR"/*.dump; do
		alvo="${CIFRADOS}/$(basename "$f").gpg"
		[ -f "$alvo" ] && continue
		log "a cifrar $(basename "$f")"
		gpg --batch --yes --symmetric --cipher-algo AES256 \
			--passphrase-file "$PASSFILE" --output "$alvo" "$f"
	done
	ORIGEM="$CIFRADOS"
	;;
rclone | '')
	# O remoto `crypt` cifra do lado do rclone: manda-se o ficheiro como está.
	ORIGEM="$BACKUP_DIR"
	;;
*)
	log "ERRO: OFFSITE_CIFRA='${CIFRA}' não é reconhecido (usa rclone ou gpg)"
	exit 1
	;;
esac

log "a enviar ${ORIGEM} → ${REMOTE}"
# --immutable: o rclone falha se um ficheiro que já existe no remoto mudou de
# conteúdo. Um dump é imutável por natureza, por isso uma alteração significa que
# algo está errado do lado de cá — e é melhor falhar do que sobrescrever a cópia boa.
if ! rclone copy "$ORIGEM" "$REMOTE" \
	--include '*.dump' --include '*.dump.gpg' \
	--immutable --no-traverse --stats-one-line; then
	log "ERRO: o rclone falhou — as cópias locais ficaram intactas"
	exit 1
fi

REMOTOS="$(rclone lsf "$REMOTE" 2>/dev/null | grep -c '\.dump' || true)"
log "OK — ${REMOTOS} cópia(s) no destino remoto"

cat <<'NOTA'
[offsite] Falta o passo que este script não pode dar por ti:
[offsite]   1. Regras de ciclo de vida no balde, para a retenção longa (e para o
[offsite]      servidor comprometido não poder apagar o histórico).
[offsite]   2. A chave/frase de cifra guardada FORA deste servidor.
[offsite]   3. Um ensaio de restauro a partir do remoto, não do disco local —
[offsite]      ver o cabeçalho de scripts/restore.sh.
NOTA
