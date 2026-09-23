'use client';
import { useAuth } from '@/app/providers';
import FaturasPanel from '@/components/reception/FaturasPanel';
import RecuperacaoPanel from '@/components/reception/RecuperacaoPanel';
import { clinicaMono, PageChrome, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// O mesmo par que o admin tem: uma fatura por pagar é o primeiro item da lista de
// recuperação. Ao balcão a ligação é ainda mais direta — quem liga a cobrar é quem
// atende.
//
// Saiu daqui «Finanças», que estava neste grupo e mostrava o desempenho financeiro da
// clínica. As contas do negócio não são trabalho de balcão: quem as quer ver é o dono, e
// para esse existem em Receita e Custos.
const TABS = [
  { key: 'faturas', label: 'Faturas' },
  { key: 'recuperacao', label: 'Recuperação' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Faturacao() {
  const { user } = useAuth();
  const [tab, setTab] = useTabHash(CHAVES, 'faturas');

  return (
    <div>
      <PageChrome
        title="Faturação"
        context={clinicaMono(user?.tenantName || user?.clinic)}
        nav={<Tabs tabs={TABS} active={tab} onChange={setTab} compact />}
      />

      {tab === 'faturas' && <FaturasPanel />}
      {tab === 'recuperacao' && <RecuperacaoPanel />}
    </div>
  );
}
