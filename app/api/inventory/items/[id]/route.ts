import { appendAudit } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asInt, sanitizeString } from '@/lib/validate';

// ─── O catálogo é partilhado; a política de reposição não é ──────────────────
// `inventory_items` não tem tenant_id de propósito (migração 044): ninguém quer
// manter a mesma lista de luvas em vinte clínicas. Mas esta rota escrevia
// `reorder_at` DIRETAMENTE nessa tabela global, com `inventory:manage` — que um
// admin de clínica tem por omissão. Mudar o limiar numa clínica mudava-o em todas,
// que é textualmente o problema que a migração 044 foi escrita para resolver: ela
// criou `inventory_item_settings` (por clínica, com RLS) e a interface continuou a
// escrever na coluna global.
//
// Agora: quem tem clínica escreve na sua própria política; só a plataforma (um
// super-admin, sem tenantId) mexe no catálogo que todos veem.
export const PUT = withRoute<{ id: string }>(
  { permission: 'inventory:manage', tenant: 'optional' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    const itemId = Number(id);
    if (!Number.isInteger(itemId)) return badRequest('Item inválido');

    const prev = await queryOne(`SELECT * FROM inventory_items WHERE id=$1`, [itemId]);
    if (!prev) return notFound('Inventory item not found');

    const body = await request.json();
    const querIdentidade =
      (body.item !== undefined && sanitizeString(body.item, 200) !== prev.item) ||
      (body.unit !== undefined && (sanitizeString(body.unit, 50) || prev.unit) !== prev.unit);

    // ─── Caminho da clínica ────────────────────────────────────────────────
    if (tenantId) {
      if (querIdentidade) {
        // O nome e a unidade são o catálogo. Renomear daqui mudava a lista de toda
        // a gente, e o registo ficava a dizer que tinha sido esta clínica.
        return forbidden();
      }

      // reorder_at a NULL = volta a seguir o catálogo; não é o mesmo que zero.
      let reorderAt: number | null = null;
      if (body.reorderAt !== undefined && body.reorderAt !== null && String(body.reorderAt).trim() !== '') {
        reorderAt = asInt(body.reorderAt, { min: 0 });
        if (reorderAt === null) return badRequest('O ponto de reposição tem de ser zero ou mais');
      }

      const [settings] = await query(
        `INSERT INTO inventory_item_settings (tenant_id, item_id, reorder_at, active)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, item_id)
         DO UPDATE SET reorder_at=EXCLUDED.reorder_at, active=EXCLUDED.active, updated_at=NOW()
         RETURNING *`,
        [tenantId, itemId, reorderAt, body.active === undefined ? true : !!body.active],
      );

      await appendAudit(
        user,
        'UPDATE',
        `Inventário — política de "${prev.item}"`,
        `reorder_at:${prev.reorder_at}`,
        `reorder_at:${settings.reorder_at}`,
        user.clinic,
      );

      // A interface espera a forma de um item do catálogo; devolve-se com o limiar
      // efetivo desta clínica por cima, para o ecrã mostrar o que passou a valer.
      return Response.json({
        ...prev,
        reorder_at: settings.reorder_at ?? prev.reorder_at,
        tenant_reorder_at: settings.reorder_at,
        active: settings.active,
      });
    }

    // ─── Caminho da plataforma: o catálogo que todos veem ──────────────────
    const item = body.item !== undefined ? sanitizeString(body.item, 200) || prev.item : prev.item;
    const unit = body.unit !== undefined ? sanitizeString(body.unit, 50) || prev.unit : prev.unit;
    const reorderAt =
      body.reorderAt !== undefined ? (asInt(body.reorderAt, { min: 0 }) ?? prev.reorder_at) : prev.reorder_at;

    const [row] = await query(
      `UPDATE inventory_items SET item=$1, unit=$2, reorder_at=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [item, unit, reorderAt, itemId],
    );
    // A linha pode desaparecer entre o SELECT e este UPDATE — 404, e não um 500 em row.X.
    if (!row) return notFound('Inventory item not found');

    await appendAudit(
      user,
      'UPDATE',
      `Inventory item: ${prev.item}`,
      `reorder_at:${prev.reorder_at}`,
      `reorder_at:${row.reorder_at}`,
      user.clinic,
    );

    return Response.json(row);
  },
);
