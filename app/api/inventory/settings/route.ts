import { appendAudit } from '@/lib/audit';
import { query } from '@/lib/db';
import { badRequest, ok } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asFee } from '@/lib/validate';

// Política de reposição desta clínica sobre o catálogo partilhado (migração 044).
// O catálogo de itens é global de propósito — ninguém quer manter a mesma lista de
// luvas em vinte clínicas — mas o ponto de reposição não pode ser: uma clínica com
// três cadeiras e outra com doze não repõem no mesmo nível.
export const GET = withRoute({ permission: 'inventory:manage' }, async ({ tenantId }) => {
  const rows = await query(
    `SELECT i.id AS item_id, i.item, i.unit,
            i.reorder_at AS global_reorder_at,
            s.reorder_at AS tenant_reorder_at,
            COALESCE(s.reorder_at, i.reorder_at) AS effective_reorder_at,
            COALESCE(s.active, TRUE) AS active
       FROM inventory_items i
       LEFT JOIN inventory_item_settings s ON s.item_id = i.id AND s.tenant_id = $1
      ORDER BY i.item`,
    [tenantId],
  );
  return ok(rows);
});

export const PUT = withRoute({ permission: 'inventory:manage' }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => ({}));
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId)) return badRequest('itemId inválido');

  const item = await query(`SELECT id, item FROM inventory_items WHERE id=$1`, [itemId]);
  if (!item.length) return badRequest('Item não existe no catálogo');

  // reorder_at a null = volta a seguir o catálogo global; não é o mesmo que zero.
  let reorderAt: number | null = null;
  if (body.reorderAt !== undefined && body.reorderAt !== null && String(body.reorderAt).trim() !== '') {
    reorderAt = asFee(body.reorderAt);
    if (reorderAt === null || reorderAt < 0) return badRequest('O ponto de reposição tem de ser zero ou mais');
  }

  const [row] = await query(
    `INSERT INTO inventory_item_settings (tenant_id, item_id, reorder_at, active)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, item_id)
     DO UPDATE SET reorder_at=EXCLUDED.reorder_at, active=EXCLUDED.active, updated_at=NOW()
     RETURNING *`,
    [tenantId, itemId, reorderAt, body.active === undefined ? true : !!body.active],
  );
  await appendAudit(user, 'UPDATE', `Inventário — política de "${item[0].item}"`, null, String(reorderAt), user.clinic);
  return ok(row);
});
