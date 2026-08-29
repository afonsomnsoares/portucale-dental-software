import { Empty, MetricCard } from '@/components/ui';
import type { AgendaEfficiency } from '@/lib/types';

export default function EfficiencyTab({ efficiency }: { efficiency: AgendaEfficiency | null }) {
  if (!efficiency) return <Empty message="Sem dados de eficiência disponíveis." />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
      <MetricCard
        label="UTILIZAÇÃO DA AGENDA"
        value={`${efficiency.utilizationPct}%`}
        sub={`${efficiency.bookedMinutes} de ${efficiency.capacityMinutes} min · ${efficiency.operatories} cadeira(s) · ${efficiency.windowDays} dias`}
        color={efficiency.utilizationPct >= 70 ? 'var(--green)' : 'var(--amber)'}
      />
      <MetricCard
        label="FRAGMENTAÇÃO"
        value={`${efficiency.fragmentation.gapMinutes} min`}
        sub={`${efficiency.fragmentation.gapCount} intervalo(s) entre consultas na mesma cadeira`}
        color="var(--amber)"
      />
      <MetricCard
        label="CANCELAMENTOS DE ÚLTIMA HORA"
        value={efficiency.lastMinuteCancellations.withinTwoDays}
        sub={`de ${efficiency.lastMinuteCancellations.total} cancelamentos (≤48h de antecedência)`}
        color="var(--red)"
      />
    </div>
  );
}
