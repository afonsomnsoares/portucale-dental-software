import { forbidden, scopeTenant } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { asDate } from '@/lib/validate';

export const GET = withRoute({ permission: 'finance:read', tenant: 'optional' }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  // Only a super-admin (role=admin with no tenantId of their own) may pick a
  // tenant via the query string; everyone else is confined to their own,
  // matching the pattern used everywhere else (e.g. app/api/patients/route.ts).
  const tenantId = scopeTenant(user, request, searchParams.get('tenantId'));
  if (!tenantId) return forbidden();

  const from = asDate(searchParams.get('from'));
  const to = asDate(searchParams.get('to'));

  const params: unknown[] = [tenantId];
  let dateFilter = '';
  if (from && to) {
    dateFilter = ' AND i.invoice_date BETWEEN $2::date AND $3::date';
    params.push(from, to);
  }

  const totals = (
    await query(
      `SELECT
         COUNT(*)::int AS total_invoices,
         COALESCE(SUM(amount),0)::numeric AS total_amount,
         COALESCE(SUM(paid),0)::numeric AS total_paid,
         COALESCE(SUM(amount - paid),0)::numeric AS total_outstanding
       FROM invoices i
       WHERE i.tenant_id = $1${dateFilter}`,
      params,
    )
  )[0];

  const statusCounts = await query(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
     FROM invoices i
     WHERE i.tenant_id = $1${dateFilter}
     GROUP BY status ORDER BY status`,
    params,
  );

  const byDentist = await query(
    `SELECT
       COALESCE(d.name, 'Unassigned') AS dentist_name,
       COUNT(*)::int AS invoice_count,
       COALESCE(SUM(i.amount),0)::numeric AS total_amount,
       COALESCE(SUM(i.paid),0)::numeric AS total_paid
     FROM invoices i
     LEFT JOIN users d ON d.id = i.dentist_id
     WHERE i.tenant_id = $1${dateFilter}
     GROUP BY d.name ORDER BY total_amount DESC`,
    params,
  );

  const dailyRevenue = await query(
    `SELECT
       i.invoice_date::text AS day,
       COUNT(*)::int AS invoices,
       COALESCE(SUM(i.paid),0)::numeric AS revenue
     FROM invoices i
     WHERE i.tenant_id = $1${dateFilter}
       AND i.paid > 0
     GROUP BY i.invoice_date ORDER BY i.invoice_date`,
    params,
  );

  const patientBalance = await queryOne(
    `SELECT COALESCE(SUM(balance),0)::numeric AS total_balance
     FROM patients WHERE tenant_id = $1`,
    [tenantId],
  );

  const recentPayments = await query(
    `SELECT i.id, i.patient_name, i.paid, i.amount, i.status, i.method, i.invoice_date, i.updated_at
     FROM invoices i
     WHERE i.tenant_id = $1 AND i.paid > 0
     ORDER BY i.updated_at DESC LIMIT 20`,
    [tenantId],
  );

  return Response.json({
    totals,
    statusCounts,
    byDentist,
    dailyRevenue,
    patientBalance: Number(patientBalance?.total_balance || 0),
    recentPayments,
  });
});
