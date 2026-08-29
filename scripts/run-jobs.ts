// scripts/run-jobs.ts — run with: node --import tsx --env-file=.env scripts/run-jobs.ts
// Unattended counterpart to the admin-triggered POST /api/jobs/run: loops every active
// tenant and runs the full job pipeline (reminders, no-show risk scoring, proactive risk
// outreach, lifecycle reactivation outreach, sending queued SMS notifications,
// waitlist offer expiry, upload retention, nightly summary, revenue recovery snapshot)
// via the same lib/jobsRunner.ts used by the HTTP route — see that file for what each
// job actually does. Meant to be invoked on a schedule (see the `jobs` service in
// docker-compose.yml); a single run here does one pass over every tenant and exits.
import { listActiveTenantIds, runJob, SYSTEM_ACTOR } from '../lib/jobsRunner.ts';

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
