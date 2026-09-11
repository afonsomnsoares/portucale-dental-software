import Costing from '@/components/clinic/pages/Costing';
import { computeMarginReport } from '@/lib/costing';
import { requirePage } from '@/lib/serverPage';

// A margem varre as consultas do período todo e imputa-lhes material, trabalho e
// custos fixos — é cara o suficiente para valer a pena estar pronta quando a
// página chega.
//
// O período de arranque é o mês corrente, o mesmo que o componente usava como
// valor inicial. Mudar as datas continua a passar por /api/finance/margin: é
// interação, e o seletor tem de responder sem recarregar a página.
export default async function Page() {
  const { tenantId } = await requirePage({ permission: 'finance:read' });
  const hoje = new Date();
  const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toLocaleDateString('en-CA');
  const ate = hoje.toLocaleDateString('en-CA');
  const relatorio = await computeMarginReport(tenantId, de, ate);
  return <Costing initialReport={relatorio} initialFrom={de} initialTo={ate} />;
}
