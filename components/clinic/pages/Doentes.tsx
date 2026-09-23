'use client';
import Lifecycle from '@/components/clinic/pages/Lifecycle';
import PatientScoring from '@/components/clinic/pages/PatientScoring';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// A carteira de doentes vista de duas maneiras: onde cada pessoa está no percurso, e
// quem é que merece um telefonema primeiro. Eram duas entradas de menu — «Jornada» e
// «Análise de Doentes» — e são a mesma pergunta do dono da clínica, que nunca é «quem
// são os doentes» mas sim «o que está a acontecer à carteira».
const TABS = [
  { key: 'jornada', label: 'Jornada' },
  { key: 'analise', label: 'Análise' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Doentes() {
  const [tab, setTab] = useTabHash(CHAVES, 'jornada');

  return (
    <div>
      <PageHeader title="Doentes" sub="Onde está cada pessoa no percurso, e a quem ligar primeiro" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'jornada' && <Lifecycle />}
      {tab === 'analise' && <PatientScoring />}
    </div>
  );
}
