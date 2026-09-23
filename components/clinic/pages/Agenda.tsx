'use client';
import Forecast from '@/components/clinic/pages/Forecast';
import ScheduleIntel from '@/components/clinic/pages/ScheduleIntel';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// A agenda daqui para a frente: o risco dos próximos dias e a previsão para o horizonte
// seguinte. A «Previsão» esteve num grupo à parte, mas das seis métricas que
// lib/forecast.ts calcula, quatro são de agenda — ocupação, procura, cancelamentos e
// capacidade livre. É uma leitura da agenda, não das contas.
const TABS = [
  { key: 'inteligente', label: 'Agenda Inteligente' },
  { key: 'previsao', label: 'Previsão' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Agenda() {
  const [tab, setTab] = useTabHash(CHAVES, 'inteligente');

  return (
    <div>
      <PageHeader title="Agenda" sub="Risco de faltas, eficiência, lista de espera e o que aí vem" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'inteligente' && <ScheduleIntel />}
      {tab === 'previsao' && <Forecast />}
    </div>
  );
}
