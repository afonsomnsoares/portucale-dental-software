'use client';
import Costing from '@/components/clinic/pages/Costing';
import Finance from '@/components/clinic/pages/Finance';
import Reports from '@/components/shared/Reports';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// Três entradas de menu sobre o mesmo assunto: quanto entrou, quanto sobrou e como
// correu. «Finanças» e «Relatórios» estavam em grupos diferentes (FINANCEIRO e RECEITA)
// apesar de responderem à mesma pergunta por ângulos diferentes, e «Custos e Margem» é
// a mesma receita com o custo descontado.
//
// A ordem é a da pergunta: primeiro o que entrou, depois o que sobrou, e só então o
// relatório que explica porquê.
const TABS = [
  { key: 'financas', label: 'Finanças' },
  { key: 'margem', label: 'Custos e Margem' },
  { key: 'relatorios', label: 'Relatórios' },
];

const CHAVES = TABS.map((t) => t.key);

export default function ReceitaCustos() {
  const [tab, setTab] = useTabHash(CHAVES, 'financas');

  return (
    <div>
      <PageHeader title="Receita e Custos" sub="Quanto entrou, quanto sobrou, e o que explica a diferença" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'financas' && <Finance />}
      {tab === 'margem' && <Costing />}
      {tab === 'relatorios' && <Reports />}
    </div>
  );
}
