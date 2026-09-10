import { Badge, RiskBadge } from '@/components/ui';
import type { Appointment } from '@/lib/types';
import ChairGraphic, { CHAIR_COLORS } from './ChairGraphic';

function toMins(t = '00:00') {
  const p = String(t).slice(0, 5).split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
}

export default function OperatoryPanel({
  chairs,
  todays,
  nowMins,
  statusTransitions,
  updatingId,
  onSetStatus,
}: {
  chairs: number[];
  todays: Appointment[];
  nowMins: number;
  statusTransitions: Record<string, string[]>;
  updatingId: string | null;
  onSetStatus: (apt: Appointment, nextStatus: string) => void;
}) {
  return (
    <div className="card" style={{ padding: '18px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-primary)' }}>Operatory</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Treatment chairs in real time</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {chairs.slice(0, 6).map((_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: purely decorative dot indicators, fixed count
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: 'var(--radius-pill)',
                background: CHAIR_COLORS[i % CHAIR_COLORS.length],
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {chairs.map((chair, index) => {
          const color = CHAIR_COLORS[index % CHAIR_COLORS.length];
          const chairAppts = todays.filter((a) => Number(a.chair) === chair);
          const current =
            chairAppts.find((a) => ['in-operatory', 'procedure-active', 'ready-dismissal'].includes(a.status)) || null;
          const nextScheduled =
            chairAppts.find(
              (a) => ['confirmed', 'registered', 'waiting'].includes(a.status) && toMins(a.start_time) >= nowMins,
            ) || null;

          return (
            <div
              key={chair}
              style={{
                border: '1px solid var(--bg-sunken)',
                borderRadius: 'var(--radius-card)',
                padding: '14px 14px 12px',
                background: 'white',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ChairGraphic color={color} occupied={!!current} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-primary)' }}>
                      {current ? current.patient_name || '—' : 'Available'}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 170,
                      }}
                    >
                      {current
                        ? `${String(current.start_time || '').slice(0, 5)} · ${current.type}`
                        : nextScheduled
                          ? `Next ${String(nextScheduled.start_time || '').slice(0, 5)} · ${nextScheduled.patient_name || '—'}`
                          : 'No next'}
                    </div>
                    {current?.dentist_name && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 170,
                        }}
                      >
                        {current.dentist_name}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 'var(--radius-pill)',
                    background: current ? color : 'var(--border-subtle)',
                  }}
                />
              </div>

              {current && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <Badge s={current.status} />
                    {(current.risk_score || 0) >= 30 && <RiskBadge score={current.risk_score || 0} />}
                  </div>

                  {(() => {
                    const transitions = statusTransitions[current.status] || [];
                    const next = transitions[0] || null;
                    const canNoShow = transitions.includes('no-show');
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <button
                          type="button"
                          disabled={!next || updatingId === current.id}
                          onClick={() => next && onSetStatus(current, next)}
                          style={{
                            width: '100%',
                            background: next ? color : 'var(--bg-sunken)',
                            color: next ? 'white' : 'var(--text-muted)',
                            border: 'none',
                            borderRadius: 'var(--radius-control)',
                            padding: '9px 0',
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: !next || updatingId === current.id ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            opacity: updatingId === current.id ? 0.7 : 1,
                          }}
                        >
                          {updatingId === current.id ? 'Updating…' : next ? `→ ${next.replace(/-/g, ' ')}` : '—'}
                        </button>
                        <button
                          type="button"
                          disabled={!canNoShow || updatingId === current.id}
                          onClick={() => canNoShow && onSetStatus(current, 'no-show')}
                          style={{
                            width: '100%',
                            background: canNoShow ? 'var(--urgency-critical-bg)' : 'var(--bg-page)',
                            color: canNoShow ? 'var(--urgency-critical)' : 'var(--text-muted)',
                            border: `1px solid ${canNoShow ? 'var(--urgency-critical-border)' : 'var(--bg-sunken)'}`,
                            borderRadius: 'var(--radius-control)',
                            padding: '9px 0',
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: !canNoShow || updatingId === current.id ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            opacity: updatingId === current.id ? 0.7 : 1,
                          }}
                        >
                          No-show
                        </button>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
