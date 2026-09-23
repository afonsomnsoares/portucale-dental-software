import { appendAudit } from '@/lib/audit';
import { query, queryRead } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asInt, sanitizeString } from '@/lib/validate';

// inventory_items is the master catalog: global rows (tenant_id NULL) that every clinic
// tracks stock against via inventory_stock/batches/movements, plus — since migration 066 —
// rows a clinic created for itself, visible to that clinic only. There was previously no
// way to create one at all (only app/api/inventory's PUT, which sets a tenant's quantity
// for an item that must already exist) — this is what makes the rest of item 13
// (forecast/batches/purchase orders) actually reachable without going straight to psql.
//
// O filtro explícito repete a política de RLS de propósito: o super-admin passa ao lado
// dela, e dentro de uma clínica (cookie acting_tenant) veria os artigos próprios de todas.
export const GET = withRoute({ permission: 'inventory:manage', tenant: 'optional' }, async ({ tenantId }) => {
  const rows = await queryRead(
    `SELECT * FROM inventory_items
      WHERE ($1::uuid IS NULL OR tenant_id IS NULL OR tenant_id = $1::uuid)
      ORDER BY item`,
    [tenantId || null],
  );
  return Response.json(rows);
});

// ─── Quem cria dentro de uma clínica, cria para a clínica ───────────────────
// Até à migração 066 este INSERT não tinha tenant_id e ia direto para o catálogo que
// todas as clínicas veem, com uma permissão que qualquer admin de clínica tem. Agora o
// artigo fica da clínica que o criou; só a plataforma (super-admin fora de uma clínica,
// tenantId vazio) acrescenta ao catálogo global.
export const POST = withRoute(
  { permission: 'inventory:manage', tenant: 'optional' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    const item = sanitizeString(body.item, 200);
    if (!item) return badRequest('item is required');
    const unit = sanitizeString(body.unit, 50) || 'unit';
    const reorderAt = asInt(body.reorderAt, { min: 0 });

    const [row] = await query(
      `INSERT INTO inventory_items (item, unit, reorder_at, tenant_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [item, unit, reorderAt ?? 10, tenantId || null],
    );

    await appendAudit(user, 'CREATE', `Inventory item: ${item}`, null, `reorder_at:${row.reorder_at}`, user.clinic);

    return created(row);
  },
);
