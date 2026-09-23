'use client';
import Invoices from '@/components/clinic/pages/Invoices';
import Recovery from '@/components/clinic/pages/Recovery';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// O que está faturado e o que está por cobrar. Eram duas entradas em dois grupos
// diferentes do menu — «Faturas» em RECEITA, «Recuperação» também — e a segunda é
// literalmente a continuação da primeira: uma fatura que não foi paga é o começo de uma
// lista de recuperação.
const TABS = [
  { key: 'faturas', label: 'Faturas' },
  { key: 'recuperacao', label: 'Recuperação' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Faturacao() {
  const [tab, setTab] = useTabHash(CHAVES, 'faturas');

  return (
    <div>
      <PageHeader title="Faturação" sub="O que está faturado, e o que está por cobrar" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'faturas' && <Invoices />}
      {tab === 'recuperacao' && <Recovery />}
    </div>
  );
}
