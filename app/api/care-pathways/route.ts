import { appendAudit } from '@/lib/audit';
import { listPathwayTemplates, previewPathway, savePathwayTemplate } from '@/lib/carePathway';
import { PATHWAY_ACTION_LABELS, PATHWAY_ACTIONS } from '@/lib/carePathwayCalc';
import { withRoute } from '@/lib/route';

// Percursos de consulta: o que tem de acontecer antes e depois de cada tipo de consulta.
// «implante amanhã → gerar consentimento, confirmar jejum, verificar dados em falta».
export const GET = withRoute({ permission: 'care-pathways:manage' }, async ({ request, tenantId }) => {
  const templates = await listPathwayTemplates(tenantId);
  // Pré-visualização opcional: sem ela ninguém percebe o que acabou de configurar até
  // aparecer a próxima consulta daquele tipo.
  const previewDate = new URL(request.url).searchParams.get('previewDate');
  return Response.json({
    templates: templates.map((t) => ({
      ...t,
      preview: previewDate ? previewPathway(t.steps, previewDate) : undefined,
    })),
    actions: PATHWAY_ACTIONS.map((a) => ({ value: a, label: PATHWAY_ACTION_LABELS[a] })),
  });
});

export const POST = withRoute({ permission: 'care-pathways:manage' }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.steps)) {
    return Response.json({ error: 'Corpo inválido: esperado { appointmentType, name, steps[] }' }, { status: 400 });
  }
  const result = await savePathwayTemplate(tenantId, user.id, body);
  if (!result.ok)
    return Response.json({ error: result.errors.join(' '), errors: result.errors }, { status: result.status });
  await appendAudit(user, 'CREATE', `Percurso de consulta: ${result.template.name}`, null, 'ok', user.clinic);
  return Response.json(result.template, { status: 201 });
});
