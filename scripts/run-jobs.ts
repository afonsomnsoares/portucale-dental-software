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

import { listActiveTenantIds, runGroupReview, runJob, SYSTEM_ACTOR } from '../lib/jobsRunner.ts';

async function main() {
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
