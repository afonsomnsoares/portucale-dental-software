import { appendAudit } from '@/lib/audit';
import { listPathwayTemplates, savePathwayTemplate } from '@/lib/carePathway';
import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const PUT = withRoute<{ id: string }>(
  { permission: 'care-pathways:manage' },
  async ({ request, user, tenantId, params }) => {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.steps)) return Response.json({ error: 'Corpo inválido' }, { status: 400 });
    const result = await savePathwayTemplate(tenantId, user.id, { ...body, id: params.id });
    if (!result.ok) {
      return Response.json({ error: result.errors.join(' '), errors: result.errors }, { status: result.status });
    }
    await appendAudit(user, 'UPDATE', `Percurso de consulta: ${result.template.name}`, null, 'ok', user.clinic);
    return Response.json(result.template);
  },
);

export const DELETE = withRoute<{ id: string }>(
  { permission: 'care-pathways:manage' },
  async ({ user, tenantId, params }) => {
    const [row] = await query(`DELETE FROM care_pathway_templates WHERE id=$1 AND tenant_id=$2 RETURNING name`, [
      params.id,
      tenantId,
    ]);
    if (!row) return Response.json({ error: 'Percurso não encontrado' }, { status: 404 });
    await appendAudit(user, 'DELETE', `Percurso de consulta: ${row.name}`, null, 'ok', user.clinic);
    return Response.json({ ok: true, remaining: (await listPathwayTemplates(tenantId)).length });
  },
);
