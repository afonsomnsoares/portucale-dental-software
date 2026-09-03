'use client';
import { AlertBanner, Badge, Empty, MetricCard, Spinner } from '@/components/ui';
import type { OptimizerMoveKind, ScheduleOptimization } from '@/lib/types';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário". A aba Eficiência
// mostra o diagnóstico (ocupação, fragmentação); esta mostra o que fazer com ele.
// Nada aqui executa nada: cada linha é uma proposta para alguém decidir, porque
// mover uma consulta implica falar com o doente.

const KIND_META: Record<OptimizerMoveKind, { label: string; bg: string; color: string }> = {
  gap_fill: { label: 'Encaixe', bg: 'var(--green-bg)', color: 'var(--green)' },
  unassigned_dentist: { label: 'Sem dentista', bg: 'var(--amber-bg)', color: 'var(--amber)' },
  equipment_block: { label: 'Equipamento', bg: 'var(--brand-bg)', color: 'var(--brand)' },
  preference_mismatch: { label: 'Preferência', bg: 'var(--red-bg)', color: 'var(--red)' },
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
          color={totals.recoverableMinutes > 0 ? 'var(--green)' : 'var(--ink-3)'}
        />
        <MetricCard
          label="PROPOSTAS"
          value={totals.moves}
          sub={
            Object.entries(byKind)
              .map(([k, n]) => `${n} ${KIND_META[k as OptimizerMoveKind]?.label.toLowerCase() || k}`)
              .join(' · ') || 'nada a otimizar'
          }
          color="var(--brand)"
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
                style={{ padding: '12px 14px', boxShadow: 'none', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center justify-between mb-1" style={{ gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{m.title}</span>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                    {m.gainMinutes > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
                        +{formatHours(m.gainMinutes)}
                      </span>
                    )}
                    <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
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
