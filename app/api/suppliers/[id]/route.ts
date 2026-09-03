import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound, ok } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { sanitizeString } from '@/lib/validate';

export const PUT = withRoute<{ id: string }>(
  { permission: 'inventory:manage' },
  async ({ request, user, tenantId, params }) => {
    const prev = await queryOne(`SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2`, [params.id, tenantId]);
    if (!prev) return notFound('Fornecedor não encontrado');

    const body = await request.json().catch(() => ({}));
    const name = body.name !== undefined ? sanitizeString(body.name, 200) : String(prev.name);
    if (!name) return badRequest('O nome do fornecedor é obrigatório');

    const [row] = await query(
      `UPDATE suppliers
          SET name=$1, email=$2, phone=$3, notes=$4, active=$5, updated_at=NOW()
        WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [
        name,
        body.email !== undefined ? sanitizeString(body.email, 254) || null : prev.email,
        body.phone !== undefined ? sanitizeString(body.phone, 50) || null : prev.phone,
        body.notes !== undefined ? sanitizeString(body.notes, 2000) : prev.notes,
        body.active !== undefined ? !!body.active : prev.active,
        params.id,
        tenantId,
      ],
    );
    await appendAudit(user, 'UPDATE', `Fornecedor — ${row.name}`, String(prev.active), String(row.active), user.clinic);
    return ok(row);
  },
);
