import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { asInt, sanitizeString } from '@/lib/validate';

// inventory_items is the master catalog — global, not tenant-scoped (every clinic tracks
// stock of the same item against the same row via inventory_stock/batches/movements), same
// as app/api/inventory's existing GET. There was previously no way to create one at all
// (only app/api/inventory's PUT, which sets a tenant's quantity for an item that must
// already exist) — this is what makes the rest of item 13 (forecast/batches/purchase
// orders) actually reachable without going straight to psql.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();
  const rows = await query(`SELECT * FROM inventory_items ORDER BY item`);
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'inventory:manage'))) return forbidden();

  const body = await request.json();
  const item = sanitizeString(body.item, 200);
  if (!item) return badRequest('item is required');
  const unit = sanitizeString(body.unit, 50) || 'unit';
  const reorderAt = asInt(body.reorderAt, { min: 0 });

  const [row] = await query(`INSERT INTO inventory_items (item, unit, reorder_at) VALUES ($1,$2,$3) RETURNING *`, [
    item,
    unit,
    reorderAt ?? 10,
  ]);

  await appendAudit(user, 'CREATE', `Inventory item: ${item}`, null, `reorder_at:${row.reorder_at}`, user.clinic);

  return created(row);
}
