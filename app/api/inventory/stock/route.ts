import { query } from '@/lib/db';
import { ok } from '@/lib/http';
import { withRoute } from '@/lib/route';

// Substitui o GET de app/api/inventory/route.ts, que foi removido nesta branch sem que as
// duas páginas de inventário deixassem de o chamar — o resultado era um ledger vazio e
// cartões de rutura a zero, sem erro nenhum no ecrã.
//
// A rota antiga tinha dois problemas que não vale a pena reintroduzir:
//
//   1. Devolvia `SELECT ... FROM inventory_stock` sem filtro de tenant a qualquer 'admin'.
//      A política de RLS de inventory_stock já bloqueava isso na base de dados, mas a rota
//      não devia depender disso — daí `tenant: 'optional'`, que dá a clínica de quem chama
//      e só deixa o super-admin (tenantId null) ver a matriz de todas.
//   2. Devolvia apenas `inventory_items.reorder_at`, o ponto de reposição GLOBAL. Desde a
//      migração 044 cada clínica pode ter o seu (inventory_item_settings.reorder_at) — uma
//      clínica com três cadeiras e outra com doze não repõem no mesmo nível. Sem o
//      COALESCE abaixo, o cartão "stock baixo" contava contra o número errado para
//      qualquer clínica que tivesse definido o seu.
//
// O COALESCE fica aqui, em SQL, e não nos componentes: são duas páginas a consumir isto
// (clinic e super-admin) e o ponto de reposição efetivo não pode divergir entre elas.
export const GET = withRoute({ permission: 'inventory:manage', tenant: 'optional' }, async ({ tenantId }) => {
  // 'optional' devolve string vazia/undefined para o super-admin; normalizar para NULL,
  // que é o que a query lê como "todas as clínicas".
  const scope = tenantId || null;

  const [items, stock] = await Promise.all([
    query(`SELECT id, item, unit, reorder_at, created_at, updated_at FROM inventory_items ORDER BY item`),
    // `reorder_at` aqui é o efetivo desta clínica para este item. Só é preciso onde há
    // linha de stock: um par (item, clínica) sem linha é quantidade 0, e 0 é "esgotado"
    // independentemente do ponto de reposição.
    query(
      `SELECT s.item_id, s.tenant_id, s.quantity,
              COALESCE(cfg.reorder_at, i.reorder_at) AS reorder_at
         FROM inventory_stock s
         JOIN inventory_items i ON i.id = s.item_id
         LEFT JOIN inventory_item_settings cfg
                ON cfg.item_id = s.item_id AND cfg.tenant_id = s.tenant_id
        WHERE ($1::uuid IS NULL OR s.tenant_id = $1::uuid)`,
      [scope],
    ),
  ]);

  return ok({ items, stock });
});
