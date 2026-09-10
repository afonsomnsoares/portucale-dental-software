import { AlertBanner, Empty, MetricCard } from '@/components/ui';
import type { AgendaEfficiency } from '@/lib/types';

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
};

function UtilizationBar({ label, pct, sub }: { label: string; sub: string; pct: number }) {
  const color = pct >= 85 ? 'var(--urgency-critical)' : pct >= 60 ? 'var(--urgency-ok)' : 'var(--urgency-soon)';
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {sub} · <strong style={{ color }}>{pct}%</strong>
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)' }}>
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: '100%',
            background: color,
            borderRadius: 'var(--radius-pill)',
          }}
        />
      </div>
    </div>
  );
}

export default function EfficiencyTab({ efficiency }: { efficiency: AgendaEfficiency | null }) {
  if (!efficiency) return <Empty message="Sem dados de eficiência disponíveis." />;

  const maxDemand = Math.max(1, ...efficiency.waitlistDemandByWeekday.map((d) => d.demand));

  return (
    <div>
      {efficiency.suggestions.length > 0 && (
        <AlertBanner type="warning">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {efficiency.suggestions.map((s) => (
              <div key={`${s.kind}-${s.subject}`}>
                <strong>{s.subject}:</strong> {s.detail}
              </div>
            ))}
          </div>
        </AlertBanner>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}
        className="mb-5"
      >
        <MetricCard
          label="UTILIZAÇÃO DA AGENDA"
          value={`${efficiency.utilizationPct}%`}
          sub={`${efficiency.bookedMinutes} de ${efficiency.capacityMinutes} min · ${efficiency.operatories} cadeira(s) · ${efficiency.windowDays} dias`}
          color={efficiency.utilizationPct >= 70 ? 'var(--urgency-ok)' : 'var(--urgency-soon)'}
        />
        <MetricCard
          label="FRAGMENTAÇÃO"
          value={`${efficiency.fragmentation.gapMinutes} min`}
          sub={`${efficiency.fragmentation.gapCount} intervalo(s) entre consultas na mesma cadeira`}
          color="var(--urgency-soon)"
        />
        <MetricCard
          label="CANCELAMENTOS DE ÚLTIMA HORA"
          value={efficiency.lastMinuteCancellations.withinTwoDays}
          sub={`de ${efficiency.lastMinuteCancellations.total} cancelamentos (≤48h de antecedência)`}
          color="var(--urgency-critical)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="mb-5">
        <div className="card p-5">
          <div className="section-label mb-3">DISPONIBILIDADE DOS DENTISTAS</div>
          {!efficiency.byDentist.length ? (
            <Empty message="Sem consultas atribuídas a um dentista neste período." />
          ) : (
            efficiency.byDentist.map((d) => (
              <UtilizationBar
                key={d.dentistId}
                label={d.dentistName}
                pct={d.utilizationPct}
                sub={`${d.bookedMinutes} min`}
              />
            ))
          )}
        </div>

        <div className="card p-5">
          <div className="section-label mb-3">DISPONIBILIDADE DAS CADEIRAS</div>
          {!efficiency.byChair.length ? (
            <Empty message="Sem consultas neste período." />
          ) : (
            efficiency.byChair.map((c) => (
              <UtilizationBar
                key={c.chair}
                label={`Cadeira ${c.chair}`}
                pct={c.utilizationPct}
                sub={`${c.bookedMinutes} min`}
              />
            ))
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="section-label mb-1">PROCURA DA LISTA DE ESPERA POR DIA</div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Quantos pacientes ativos na lista de espera preferem cada dia — cruza com o heatmap de risco para saber para
          onde vale a pena mover marcações.
        </p>
        <div className="flex items-end gap-3" style={{ height: 120 }}>
          {efficiency.waitlistDemandByWeekday.map((d) => (
            <div key={d.weekday} className="flex flex-col items-center" style={{ flex: 1 }}>
              <div
                style={{
                  width: '100%',
                  maxWidth: 40,
                  height: `${Math.max(4, (d.demand / maxDemand) * 90)}px`,
                  background: d.demand > 0 ? 'var(--accent)' : 'var(--bg-sunken)',
                  borderRadius: 'var(--radius-control)',
                }}
              />
              <div className="text-xs mt-2" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {d.demand}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {WEEKDAY_LABELS[d.weekday]?.slice(0, 3)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
