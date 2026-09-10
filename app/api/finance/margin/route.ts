import { computeMarginReport } from '@/lib/costing';
import { withRoute } from '@/lib/route';

// Margem por dentista, por cadeira e por tipo de tratamento. A base de imputação do
// custo fixo é uma definição da clínica (tenant_cost_settings) e vem sempre ao lado do
// número em `method` e `warnings` — uma margem sem a base declarada é um número que se
// pode ler ao contrário.
export const GET = withRoute({ permission: 'finance:read' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const today = new Date().toLocaleDateString('en-CA');
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const from = searchParams.get('from') || firstOfMonth;
  const to = searchParams.get('to') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: 'Datas inválidas (esperado YYYY-MM-DD)' }, { status: 400 });
  }
  return Response.json(await computeMarginReport(tenantId, from, to));
});
