// scripts/check-jobs-fresh.ts — corre com:
//   node --import tsx --env-file=.env scripts/check-jobs-fresh.ts
//
// Vigia do pipeline de jobs. Corrido em ciclo pelo serviço `watchdog` do
// docker-compose.yml, ou por cron do sistema onde não haja Docker.
//
// ─── O problema que resolve ─────────────────────────────────────────────────
// lib/platformStats.ts já calcula `staleJobs` e a página Saúde do Sistema já o
// mostra. Só que é por CONSULTA: só sabe quem abrir a página. E o serviço que corre
// o pipeline é um `while true; node run-jobs.ts; sleep 900` — se aquele processo
// morrer (OOM, uma exceção no arranque, o contentor a não reiniciar), morre calado.
//
// O que para, em concreto, quando ele morre: lembretes de consulta, pontuação de
// risco de falta e o outreach que dela vem, reativação de inativos, a FILA DE SMS
// (as notificações ficam em espera e nunca saem), expiração de ofertas de lista de
// espera, retenção de uploads e os snapshots de receita. Nada disto dá erro — tudo
// isto simplesmente não acontece. A clínica descobre pelos doentes que não vieram.
//
// Por isso este processo é SEPARADO do `jobs`, e é esse o ponto todo: um vigia que
// corresse dentro do ciclo que vigia morria com ele e não se notava a diferença.
//
// ─── Sem tabela nova ───────────────────────────────────────────────────────
// O estado do próprio vigia (quando alertou pela última vez) vive num ficheiro e
// não na base de dados, deliberadamente. A regra 6 do PRODUCT.md — «é só um campo»
// — diz que uma tabela nova são uma migração, uma política de RLS e uma linha na
// cobertura de RGPD. Para não repetir um SMS de operações a cada 15 minutos, isso
// era caro demais e no sítio errado.

// Mesma escotilha do scripts/run-jobs.ts, pela mesma razão: este processo lê
// job_runs de TODAS as clínicas, sem sessão que o delimite, e por isso corre pela
// ligação admin. Sem isto, o APP_DATABASE_URL do .env partilhado entrava aqui e a
// leitura vinha fail-closed (0 linhas) — um vigia que reportava "nada a correr"
// por não conseguir ver nada seria pior do que não haver vigia nenhum.
delete process.env.APP_DATABASE_URL;
process.env.PORTUCALE_ADMIN_CONNECTION = '1';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query, withSystemContext } from '../lib/db.ts';
import { sendSms } from '../lib/sms.ts';

const STALE_AFTER_SECONDS = Number(process.env.JOBS_STALE_AFTER_SECONDS || 3600);
// Quatro horas entre SMS sobre a mesma avaria. O alerta serve para avisar uma vez,
// não para acompanhar o problema minuto a minuto — e um SMS a cada passagem do
// vigia (15 min) treinava quem o recebe a ignorá-lo, que é o único modo de falha
// que um alerta não pode ter.
const ALERT_THROTTLE_SECONDS = Number(process.env.WATCHDOG_ALERT_THROTTLE_SECONDS || 4 * 3600);
const STATE_FILE = process.env.WATCHDOG_STATE_FILE || path.join(os.tmpdir(), 'portucale-watchdog.json');

function log(msg: string) {
  console.log(`[watchdog] ${new Date().toISOString()} ${msg}`);
}

// O driver do pg devolve `timestamptz` como Date, não como string, e interpolar um
// Date num template dá o toString() local — «Mon Sep 14 2026 17:56:23 GMT+0100».
// Num alarme que pode ser lido por SMS, noutro fuso e horas depois, isso é ambíguo
// precisamente quando a hora exata é o que interessa. ISO em UTC, como o resto dos
// logs deste projeto.
function iso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

/** Quando foi o último alerta, para não repetir. Um ficheiro ilegível trata-se como «nunca». */
function lastAlertAt(): number {
  try {
    if (!existsSync(STATE_FILE)) return 0;
    return Number(JSON.parse(readFileSync(STATE_FILE, 'utf8'))?.lastAlertAt || 0);
  } catch {
    return 0;
  }
}

function markAlerted() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ lastAlertAt: Date.now() }), 'utf8');
  } catch (e) {
    // Não deixar o registo do alerta impedir o alerta: pior do que repetir um SMS
    // é engoli-lo porque /tmp não estava escrevível.
    log(`aviso: não consegui gravar o estado em ${STATE_FILE} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function alert(assunto: string, detalhe: string) {
  // O log é sempre o primeiro canal, e o único que não depende de configuração.
  console.error(`[watchdog] ALARME: ${assunto}\n[watchdog] ${detalhe}`);

  const to = process.env.OPS_ALERT_PHONE;
  if (!to) {
    log('OPS_ALERT_PHONE não definido — alarme fica só no log (ver docker-compose.yml)');
    return;
  }

  const desde = lastAlertAt();
  const decorrido = (Date.now() - desde) / 1000;
  if (desde && decorrido < ALERT_THROTTLE_SECONDS) {
    log(`SMS suprimido: já se alertou há ${Math.round(decorrido / 60)} min (limite ${ALERT_THROTTLE_SECONDS / 3600}h)`);
    return;
  }

  // Sem nome de clínica nem dado de doente nenhum: isto vai para o telefone de quem
  // administra a plataforma e é sobre a plataforma. Mesmo que fosse inócuo, um SMS é
  // um canal que não se controla depois de sair.
  const res = await sendSms({ to, body: `Portucale — ${assunto}. ${detalhe}` });
  if (res.ok) {
    log(`SMS de alarme enviado para ${to}`);
    markAlerted();
  } else {
    // Não se marca como alertado: se o SMS não saiu, a próxima passagem deve tentar
    // outra vez em vez de assumir que já avisou.
    log(`ERRO ao enviar SMS de alarme: ${res.error}`);
  }
}

async function main() {
  const rows = (await withSystemContext(() =>
    query(
      `SELECT MAX(started_at)                                             AS ultima,
              COUNT(*)                                                    AS total,
              COUNT(*) FILTER (WHERE status = 'completed'
                                 AND started_at > NOW() - INTERVAL '24 hours') AS ok_24h,
              COUNT(*) FILTER (WHERE status = 'failed'
                                 AND started_at > NOW() - INTERVAL '24 hours') AS falhas_24h
         FROM job_runs`,
    ),
  )) as unknown as Array<{ ultima: Date | string | null; total: string; ok_24h: string; falhas_24h: string }>;

  const r = rows[0];
  const total = Number(r?.total || 0);
  const ok24h = Number(r?.ok_24h || 0);
  const falhas24h = Number(r?.falhas_24h || 0);

  // ─── Caso 1: nunca correu ─────────────────────────────────────────────────
  // Distinto de "parou", e vale a pena distinguir: numa instalação nova significa
  // que o serviço `jobs` nunca arrancou, ou arrancou contra outra base de dados.
  // Uma clínica em produção pode ficar assim desde o primeiro dia sem que nada o
  // diga — não há erro nenhum a produzir, só trabalho que não se faz.
  if (total === 0 || !r?.ultima) {
    await alert(
      'o pipeline de jobs NUNCA correu nesta base de dados',
      'job_runs está vazia. Lembretes, fila de SMS, recalls e retenção não estão a acontecer. Verificar o serviço `jobs` e a que DATABASE_URL aponta.',
    );
    process.exitCode = 1;
    return;
  }

  const idadeSegundos = Math.round((Date.now() - new Date(r.ultima).getTime()) / 1000);
  const idadeMin = Math.round(idadeSegundos / 60);

  // ─── Caso 2: parou ────────────────────────────────────────────────────────
  if (idadeSegundos > STALE_AFTER_SECONDS) {
    await alert(
      `o pipeline de jobs não corre há ${idadeMin} min`,
      `Última passagem: ${iso(r.ultima)}. Limite: ${Math.round(STALE_AFTER_SECONDS / 60)} min. Lembretes e fila de SMS parados.`,
    );
    process.exitCode = 1;
    return;
  }

  // ─── Caso 3: corre e falha sempre ─────────────────────────────────────────
  // Tão invisível como parar, e mais enganador: há passagens recentes, o painel
  // mostra atividade e a página de saúde parece viva — mas nenhuma passagem chega
  // ao fim. Só é alarme quando NÃO houve nenhuma boa nas últimas 24h; falhas
  // isoladas ao lado de sucessos são a vida normal de um pipeline e não acordam
  // ninguém às 3 da manhã.
  if (falhas24h > 0 && ok24h === 0) {
    await alert(
      `o pipeline de jobs falhou ${falhas24h}x nas últimas 24h e não completou nenhuma passagem`,
      `Última tentativa: ${iso(r.ultima)}. Ver os logs do serviço \`jobs\`.`,
    );
    process.exitCode = 1;
    return;
  }

  log(`ok — última passagem há ${idadeMin} min (${ok24h} completas / ${falhas24h} falhas nas últimas 24h)`);
}

main()
  .catch((err) => {
    // Uma base de dados inalcançável é, ela própria, uma avaria que interessa —
    // não se engole como se fosse ruído do vigia.
    console.error('[watchdog] fatal:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    // Mesma razão do scripts/run-jobs.ts: o pool de lib/db.ts é um singleton de
    // processo longo e não se fecha sozinho; este é um processo de uma passagem.
    process.exit(process.exitCode || 0);
  });
