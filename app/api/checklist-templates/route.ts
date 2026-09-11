import { appendAudit } from '@/lib/audit';
import { query, queryRead } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, sanitizeString } from '@/lib/validate';

const TYPES = ['opening', 'closing', 'other'] as const;

// GET is open to any authenticated tenant member — knowing what checklists exist (to run
// one) is operational info, not something to lock down. Only creating/editing a template
// requires 'checklists:manage'.
export const GET = withRoute(
  { authOnly: 'Configuração da própria clínica', tenant: 'resolved' },
  async ({ request, tenantId }) => {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';

    const vals: unknown[] = [tenantId];
    let sql = `SELECT * FROM checklist_templates WHERE tenant_id=$1`;
    if (activeOnly) sql += ` AND active=TRUE`;
    sql += ' ORDER BY type, name';

    const rows = await queryRead(sql, vals);
    return Response.json(rows);
  },
);

export const POST = withRoute(
  { permission: 'checklists:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');

    const name = sanitizeString(body.name, 200);
    if (!name) return badRequest('name is required');
    const type = body.type ? asEnum(body.type, TYPES) : 'opening';
    if (body.type && !type) return badRequest(`type must be one of: ${TYPES.join(', ')}`);

    const items = Array.isArray(body.items)
      ? body.items.map((i: unknown) => sanitizeString(i, 300)).filter((i: string) => !!i)
      : [];
    if (!items.length) return badRequest('items must be a non-empty array of strings');

    const [row] = await query(
      `INSERT INTO checklist_templates (tenant_id, name, type, items, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
      [tenantId, name, type || 'opening', JSON.stringify(items), user.id],
    );

    await appendAudit(user, 'CREATE', `Checklist template: ${name}`, null, `${items.length} items`, user.clinic);

    return created(row);
  },
);
