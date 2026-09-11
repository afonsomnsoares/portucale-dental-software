'use client';
import { AlertBanner, Badge, Empty, MetricCard, Spinner } from '@/components/ui';
import type { OptimizerMoveKind, ScheduleOptimization } from '@/lib/types';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário". A aba Eficiência
// mostra o diagnóstico (ocupação, fragmentação); esta mostra o que fazer com ele.
// Nada aqui executa nada: cada linha é uma proposta para alguém decidir, porque
// mover uma consulta implica falar com o doente.

const KIND_META: Record<OptimizerMoveKind, { label: string; bg: string; color: string }> = {
  gap_fill: { label: 'Encaixe', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  unassigned_dentist: { label: 'Sem dentista', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  equipment_block: { label: 'Equipamento', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  preference_mismatch: { label: 'Preferência', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
};

function formatHours(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export default function OptimizerTab({
  optimization,
  loading,
}: {
  optimization: ScheduleOptimization | null;
  loading?: boolean;
}) {
  if (loading) return <Spinner />;
  if (!optimization) return <Empty message="Sem dados de otimização disponíveis." />;

  const { moves, totals, warnings, windowDays } = optimization;
  const byKind = moves.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {warnings.map((w) => (
        <AlertBanner key={w} type="warning">
          {w}
        </AlertBanner>
      ))}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}
        className="mb-5"
      >
        <MetricCard
          label="CAPACIDADE RECUPERÁVEL"
          value={formatHours(totals.recoverableMinutes)}
          sub={`nos próximos ${windowDays} dias, se as propostas de encaixe forem aceites`}
          color={totals.recoverableMinutes > 0 ? 'var(--urgency-ok)' : 'var(--text-muted)'}
        />
        <MetricCard
          label="PROPOSTAS"
          value={totals.moves}
          sub={
            Object.entries(byKind)
              .map(([k, n]) => `${n} ${KIND_META[k as OptimizerMoveKind]?.label.toLowerCase() || k}`)
              .join(' · ') || 'nada a otimizar'
          }
          color="var(--accent)"
        />
      </div>

      {!moves.length ? (
        <Empty message="Nada a otimizar — a agenda está sem buracos preenchíveis nem marcações incompletas." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {moves.map((m) => {
            const meta = KIND_META[m.kind];
            return (
              <div
                key={m.key}
                className="card"
                style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between mb-1" style={{ gap: 12 }}>
                  <span
                    style={{
                      fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {m.title}
                  </span>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                    {m.gainMinutes > 0 && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          fontWeight: 'var(--weight-bold)',
                          color: 'var(--urgency-ok)',
                        }}
                      >
                        +{formatHours(m.gainMinutes)}
                      </span>
                    )}
                    <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {m.detail}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
