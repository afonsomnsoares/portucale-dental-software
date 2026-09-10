import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { asFee, asString } from '@/lib/validate';

export const GET = withRoute<{ id: string }>(
  { permission: 'invoices:read', tenant: 'optional' },
  async ({ user, params }) => {
    const { id } = params;
    const inv = await queryOne(
      `SELECT i.*, d.name as dentist_name
     FROM invoices i
     LEFT JOIN users d ON d.id = i.dentist_id
     WHERE i.id = $1`,
      [id],
    );
    if (!inv) return Response.json({ error: 'Not found' }, { status: 404 });
    if (user.tenantId && inv.tenant_id !== user.tenantId) return forbidden();

    return Response.json(inv);
  },
);

export const PUT = withRoute<{ id: string }>(
  { permission: 'invoices:update', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;
    const inv = await queryOne(`SELECT * FROM invoices WHERE id=$1`, [id]);
    if (!inv) return Response.json({ error: 'Not found' }, { status: 404 });
    if (user.tenantId && inv.tenant_id !== user.tenantId) return forbidden();

    const body = await request.json();
    const updates: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (body.amount !== undefined) {
      const amount = asFee(body.amount);
      if (amount === null) return Response.json({ error: 'Invalid amount' }, { status: 400 });
      updates.push(`amount = $${idx++}`);
      vals.push(amount);
    }
    if (body.method !== undefined) {
      updates.push(`method = $${idx++}`);
      vals.push(String(body.method).slice(0, 50));
    }
    if (body.status !== undefined) {
      const allowed = ['pending', 'partial', 'paid', 'cancelled'];
      if (!allowed.includes(body.status)) return Response.json({ error: 'Invalid status' }, { status: 400 });
      updates.push(`status = $${idx++}`);
      vals.push(body.status);
    }
    if (body.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      vals.push(asString(body.notes, { max: 2000 }));
    }
    if (body.dueDate !== undefined) {
      updates.push(`due_date = $${idx++}::date`);
      vals.push(body.dueDate || null);
    }

    if (updates.length === 0) return Response.json({ error: 'No fields to update' }, { status: 400 });

    updates.push(`updated_at = NOW()`);

    const [updated] = await query(`UPDATE invoices SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, [
      ...vals,
      id,
    ]);

    await appendAudit(user, 'UPDATE', `Invoice ${formatId(id)} updated`, inv.status, updated.status, user.clinic);

    return Response.json(updated);
  },
);

function formatId(uuid: string) {
  return uuid ? uuid.slice(0, 8).toUpperCase() : '—';
}
