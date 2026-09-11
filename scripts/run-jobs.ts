// scripts/run-jobs.ts — run with: node --import tsx --env-file=.env scripts/run-jobs.ts
// Unattended counterpart to the admin-triggered POST /api/jobs/run: loops every active
// tenant and runs the full job pipeline (reminders, no-show risk scoring, proactive risk
// outreach, lifecycle reactivation outreach, sending queued SMS notifications,
// waitlist offer expiry, upload retention, nightly summary, revenue recovery snapshot)
// via the same lib/jobsRunner.ts used by the HTTP route — see that file for what each
// job actually does. Meant to be invoked on a schedule (see the `jobs` service in
// docker-compose.yml); a single run here does one pass over every tenant and exits.
// This process reads across every tenant with no per-request session to scope
// it (see the loop below), so — like scripts/migrate.ts — it's meant to run
// against the DATABASE_URL admin/owner connection, never the RLS-restricted
// APP_DATABASE_URL. Both share lib/db.ts's getPool(), which prefers
// APP_DATABASE_URL when set; locally that var lives in the same .env file
// `next dev` reads for the app itself (see .env's comment), so it'd otherwise
// leak into this process too. Clearing it here — before lib/db.ts's pool is
// ever created — keeps the two processes on the right connection regardless
// of what's in the shared file. docker-compose.yml's `jobs` service sidesteps
// this entirely by simply never setting the var in its own environment.
delete process.env.APP_DATABASE_URL;
// Declares the line above as deliberate: lib/db.ts refuses to fall back to the
// owner connection in production precisely because that fallback is silent, and
// this process is the one legitimate exception. Without the marker, the guard
// there would (correctly) take this for a misconfigured web server.
process.env.PORTUCALE_ADMIN_CONNECTION = '1';

// Ligação própria, fora do pool de lib/db.ts: o lock de sessão abaixo tem de durar a
// corrida inteira, e uma ligação devolvida ao pool a meio levá-lo-ia consigo.
import pg from 'pg';
import { withSystemContext } from '../lib/db.ts';
import { listActiveTenantIds, runGroupReview, runJob, SYSTEM_ACTOR } from '../lib/jobsRunner.ts';

// ─── Uma corrida de cada vez ─────────────────────────────────────────────────
// Nada impedia duas passagens de se sobreporem: o serviço `jobs` do compose a
// reiniciar enquanto a anterior ainda corria, um cron a disparar antes de a anterior
// acabar, ou um admin a carregar em POST /api/jobs/run ao mesmo tempo. Cada job
// passava então a correr duas vezes sobre os mesmos dados — o envio de SMS era o caso
// grave (ver a reserva de linhas em lib/jobsRunner.ts:sendDueNotifications), mas não
// era o único: as tarefas automáticas, os avisos de stock e os snapshots de receita
// duplicavam todos da mesma maneira.
//
// A reserva por linha resolve a fila de notificações mesmo com sobreposição; isto
// resolve o resto, e ao nível certo — a corrida inteira. Um lock de sessão, não de
// transação: dura o que durar a ligação, e fechá-la no fim liberta-o mesmo que o
// processo morra a meio. `try` e não `pg_advisory_lock` porque a segunda corrida deve
// SAIR, não esperar: esperar só serviria para repetir a seguir o trabalho que a
// primeira acabou de fazer.
const LOCK_NAME = 'portucale_run_jobs';

async function acquireRunLock(): Promise<pg.Client | null> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_NAME]);
  if (rows[0]?.ok) return client;
  await client.end();
  return null;
}

async function main() {
  const lock = await acquireRunLock();
  if (!lock) {
    console.log('[run-jobs] outra corrida já está a decorrer — nada a fazer.');
    return;
  }
  try {
    // ─── O contexto transversal é DECLARADO, não herdado da ligação ───────────
    // Sem isto, nenhum passo desta corrida estabelecia contexto nenhum, e o
    // applyTenantContext de lib/db.ts escrevia o que escreve nesse caso: o sentinela
    // NO_TENANT_SENTINEL e is_super_admin='false'. Ou seja, a corrida inteira corria
    // fail-closed — e só não se via porque DATABASE_URL aponta hoje para `postgres`,
    // um SUPERUSER, e os superusers ignoram RLS incondicionalmente, FORCE incluído.
    //
    // O pipeline dependia portanto de uma propriedade acidental da ligação. E a
    // dependência é sobre a única propriedade que o resto do projeto trabalha para
    // eliminar: o cabeçalho da migração 011 desaconselha-a, e o próprio lib/db.ts
    // grita na consola quando a deteta na aplicação. Bastava alguém seguir esse
    // conselho e apontar DATABASE_URL ao dono do schema (não-superuser, sujeito ao
    // FORCE ROW LEVEL SECURITY) para listActiveTenantIds() passar a devolver [] —
    // e a falha não seria um erro, seria «0 active tenant(s)». Os lembretes de
    // consulta parariam, a fila de SMS pararia, e o log não diria nada de anormal.
    //
    // withSystemContext diz à base de dados o que este processo é — a mesma decisão
    // que o login e o rateLimitShared já tomam, e pela mesma razão: correr fora de
    // qualquer clínica é um facto sobre o processo, não algo a inferir do papel com
    // que ele calhou de se ligar.
    //
    // É o âmbito da corrida INTEIRA, e não um contexto por clínica dentro do ciclo,
    // porque é isso que a corrida faz: o cleanupUploads de lib/jobsRunner.ts varre
    // sem filtro de clínica e o runGroupReview compara clínicas entre si. Apertar
    // isso para um contexto por tenant seria defesa em profundidade a sério, mas
    // mudaria o que esses dois passos fazem — é uma alteração à parte, não um efeito
    // colateral desta.
    await withSystemContext(() => runAllTenants());
  } finally {
    // Fechar a ligação liberta o lock; o release explícito é para o caso de a ligação
    // ficar pendurada e o `end()` demorar.
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_NAME]).catch(() => {});
    await lock.end().catch(() => {});
  }
}

async function runAllTenants() {
  const tenantIds = await listActiveTenantIds();
  console.log(`[run-jobs] ${new Date().toISOString()} — ${tenantIds.length} active tenant(s)`);

  let failures = 0;
  for (const tenantId of tenantIds) {
    const result = await runJob(tenantId, 'all', SYSTEM_ACTOR);
    if (result.ok) {
      console.log(`[run-jobs] tenant ${tenantId}: ok`, JSON.stringify(result.details));
    } else {
      failures += 1;
      console.error(`[run-jobs] tenant ${tenantId}: FAILED — ${result.error}`);
    }
  }

  // O agente Grupo compara clínicas, por isso corre uma vez no fim e não dentro do
  // ciclo — ver runGroupReview em lib/jobsRunner.ts. Um grupo com menos de duas
  // clínicas não tem nada a comparar e a função devolve zero sem chamar a IA.
  const group = await runGroupReview();
  if (group.ok) {
    console.log('[run-jobs] grupo: ok', JSON.stringify(group.details));
  } else {
    failures += 1;
    console.error(`[run-jobs] grupo: FAILED — ${group.error}`);
  }

  if (failures > 0) {
    console.error(`[run-jobs] ${failures}/${tenantIds.length} tenant(s) failed`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[run-jobs] fatal:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    // lib/db.ts's pool has no idle-shutdown call of its own (it's a long-lived singleton
    // in the Next.js server) — this script is a one-shot process, so force the event loop
    // to end instead of hanging on an open pool.
    process.exit(process.exitCode || 0);
  });
