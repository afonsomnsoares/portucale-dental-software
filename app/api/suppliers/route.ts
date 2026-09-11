import { appendAudit } from '@/lib/audit';
import { query, queryRead } from '@/lib/db';
import { badRequest, created, ok } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { sanitizeString } from '@/lib/validate';

// Fornecedores por clínica (migração 044). Ao contrário do catálogo de itens, que é
// partilhado, cada clínica compra a quem quer — por isso esta tabela tem tenant_id e
// política de RLS própria.
export const GET = withRoute({ permission: 'inventory:manage' }, async ({ request, tenantId }) => {
  const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1';
  const rows = await queryRead(
    `SELECT * FROM suppliers WHERE tenant_id=$1 ${includeInactive ? '' : 'AND active = TRUE'} ORDER BY name`,
    [tenantId],
  );
  return ok(rows);
});

export const POST = withRoute({ permission: 'inventory:manage' }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => ({}));
  const name = sanitizeString(body.name, 200);
  if (!name) return badRequest('O nome do fornecedor é obrigatório');

  // O índice único é por (tenant_id, lower(name)) — apanhar aqui dá uma mensagem
  // legível em vez de um erro cru de Postgres.
  const existing = await query(`SELECT id FROM suppliers WHERE tenant_id=$1 AND lower(name)=lower($2)`, [
    tenantId,
    name,
  ]);
  if (existing.length) return badRequest('Já existe um fornecedor com esse nome nesta clínica');

  const [row] = await query(
    `INSERT INTO suppliers (tenant_id, name, email, phone, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      tenantId,
      name,
      sanitizeString(body.email, 254) || null,
      sanitizeString(body.phone, 50) || null,
      sanitizeString(body.notes, 2000),
      user.id || null,
    ],
  );
  await appendAudit(user, 'CREATE', `Fornecedor — ${row.name}`, null, 'active', user.clinic);
  return created(row);
});
