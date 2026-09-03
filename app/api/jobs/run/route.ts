import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { type JobName, runJob } from '@/lib/jobsRunner';
import { hasPermission } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
  if (!(await hasPermission(user, 'jobs:run'))) return forbidden();

  const { searchParams } = new URL(request.url);
  const job = (searchParams.get('job') || 'all') as JobName;
  const requestedTenantId = searchParams.get('tenantId');
  const tenantId = user.role === 'super_admin' ? requestedTenantId : user.tenantId;
  if (!tenantId) return forbidden();

  const result = await runJob(tenantId, job, { id: user.id, name: user.name, role: user.role, clinic: user.clinic });
  if (!result.ok) {
    // runJob's `error` is the raw e.message from its catch — typically a Postgres error
    // carrying table/column names or fragments of the failing statement. Admin-only, so
    // the exposure is narrow, but the failure is already recorded in full in `job_runs`
    // (see logJobRun) where an operator can read it, and every other route in this
    // project keeps raw error text server-side. Same handling as reports/insight.
    console.error(`jobs/run: job "${job}" failed for tenant ${tenantId}:`, result.error);
    return Response.json(
      { ok: false, error: 'O job falhou. Ver o detalhe no registo de execuções (job_runs).' },
      { status: 500 },
    );
  }
  return Response.json(result);
}
