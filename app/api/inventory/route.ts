import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  const items = await query(`SELECT * FROM inventory_items ORDER BY item`);
  const stock = await query(`SELECT item_id, tenant_id, quantity FROM inventory_stock`);
  return Response.json({ items, stock });
}

export async function PUT(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  const { itemId, tenantId, quantity } = await request.json();
  if (!itemId || !tenantId) return Response.json({ error: 'Missing required fields' }, { status: 400 });

  const qty = Math.max(0, Number(quantity || 0));
  await query(
    `INSERT INTO inventory_stock (item_id, tenant_id, quantity)
     VALUES ($1,$2,$3)
     ON CONFLICT (item_id, tenant_id) DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=NOW()`,
    [itemId, tenantId, qty],
  );

  const [updatedItem] = await query(`SELECT * FROM inventory_items WHERE id=$1`, [itemId]);
  await appendAudit(
    user,
    'UPDATE',
    `Inventory: ${updatedItem?.item || itemId} — tenant ${tenantId}`,
    null,
    String(qty),
  );
  return Response.json({ ok: true });
}
