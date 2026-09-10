import { appendAudit, appendTimeline } from '@/lib/audit';
import { formatEUR } from '@/lib/constants';
import { withTransaction } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { asFee } from '@/lib/validate';

export const PUT = withRoute<{ id: string }>(
  { permission: 'invoices:pay', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;
    const body = await request.json();
    const payAmount = asFee(body.amount);
    if (payAmount === null || payAmount <= 0)
      return Response.json({ error: 'Invalid payment amount' }, { status: 400 });

    const method =
      String(body.method || 'cash')
        .trim()
        .slice(0, 50) || 'cash';

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM invoices WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) FOR UPDATE`,
        [id, user.tenantId],
      );
      const inv = rows[0];
      if (!inv) return { error: 'Not found', status: 404 };
      if (user.tenantId && inv.tenant_id !== user.tenantId) return { error: 'Forbidden', status: 403 };
      if (inv.status === 'paid') return { error: 'Invoice already paid', status: 400 };

      const newPaid = Number(inv.paid) + payAmount;
      const newStatus = newPaid >= Number(inv.amount) ? 'paid' : 'partial';

      const { rows: updatedRows } = await client.query(
        `UPDATE invoices SET paid = paid + $1, status = $2, method = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
        [payAmount, newStatus, method, id],
      );
      const updated = updatedRows[0];

      const balanceChange = Number(updated.amount) - Number(updated.paid);
      await client.query(`UPDATE patients SET balance = $1 WHERE id = $2`, [
        Math.max(0, balanceChange),
        inv.patient_id,
      ]);

      return { inv, updated, payAmount, newStatus, method };
    });

    if (result.error) return Response.json({ error: result.error }, { status: result.status });

    const event = `Pagamento de ${formatEUR(payAmount)} recebido na Fatura ${formatId(id)} — ${result.newStatus}`;
    await appendTimeline(result.inv.patient_id, user, 'financial', event);
    await appendAudit(
      user,
      'PAYMENT',
      `Fatura ${formatId(id)} — ${formatEUR(payAmount)} via ${result.method}`,
      result.inv.status,
      result.newStatus,
      user.clinic,
    );

    return Response.json(result.updated);
  },
);

function formatId(uuid: string) {
  return uuid ? uuid.slice(0, 8).toUpperCase() : '—';
}
