'use client';
// ─── Vagas em risco ─────────────────────────────────────────────────────────
// lib/slotRisk.ts com rota e nenhum consumidor. É diferente do separador «Risco», que
// pontua CONSULTAS pela probabilidade de o doente faltar: isto pontua LUGARES pela
// probabilidade de ficarem vazios e já não haver tempo de os encher.
//
// A distinção importa porque as duas informam decisões diferentes. Uma consulta com
// risco alto às 9h de daqui a três semanas é um telefonema de confirmação; a mesma
// consulta amanhã às 18h, sem ninguém na lista de espera que sirva, é receita
// praticamente perdida. `emptyProbability` — e não `vacancyProbability` — é o número que
// vale um telefonema, e é o que ordena esta lista.
import { Empty, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';

interface SlotRisk {
  vacancyProbability: number;
  emptyProbability: number;
  noShowProbability: number;
  recoverableProbability: number;
  fillProbability: number;
}
interface SlotProjection {
  appointmentId: string;
  patientName: string;
  date: string;
  startTime: string;
  chair: number | null;
  duration: number;
  risk: SlotRisk;
  reason?: string;
}
interface DayProjection {
  date: string;
  expectedEmptyMinutes: number;
  bookedMinutes: number;
  expectedLossRate: number;
  atRisk: SlotProjection[];
}
export interface SlotRiskReport {
  horizonDays: number;
  days: DayProjection[];
  totals: { bookedMinutes: number; expectedEmptyMinutes: number; atRisk: number };
  expectedRevenueLoss: number | null;
  explanations: Record<string, string>;
}

function dia(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export default function SlotRiskTab({ data, loading }: { data: SlotRiskReport | null; loading?: boolean }) {
  if (loading) return <Spinner />;
  if (!data?.days.length) {
    return (
      <Empty message="Sem histórico suficiente para projetar vagas. É preciso algumas semanas de faltas e cancelamentos para haver padrão." />
    );
  }

  const comRisco = data.days.filter((d) => d.atRisk.length > 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { n: String(data.totals.atRisk), t: 'lugares em risco' },
          { n: `${Math.round(data.totals.expectedEmptyMinutes / 60)} h`, t: 'de cadeira que se espera perder' },
          {
            n: data.expectedRevenueLoss !== null ? formatEUR(data.expectedRevenueLoss) : '—',
            t: 'de receita esperada em risco',
            cor: 'var(--urgency-critical)',
          },
        ].map((m) => (
          <div key={m.t}>
            <div
              style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-bold)',
                color: m.cor || 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {m.n}
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{m.t}</div>
          </div>
        ))}
      </div>

      {comRisco.length === 0 ? (
        <Empty message="Nenhum lugar acima do limiar de risco nos próximos dias." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comRisco.map((d) => (
            <div
              key={d.date}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--bg-surface)',
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)' }}>{dia(d.date)}</span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  espera-se perder {Math.round(d.expectedLossRate * 100)}% do dia · {Math.round(d.expectedEmptyMinutes)}{' '}
                  min
                </span>
              </div>

              <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.atRisk.map((s) => {
                  const p = Math.round(s.risk.emptyProbability * 100);
                  return (
                    <div
                      key={s.appointmentId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '58px minmax(0,1fr) 62px',
                        gap: 12,
                        alignItems: 'baseline',
                        fontSize: 'var(--text-xs)',
                        paddingLeft: 9,
                        borderLeft: `2px solid ${p >= 55 ? 'var(--urgency-critical)' : 'var(--urgency-soon)'}`,
                      }}
                    >
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                        {String(s.startTime).slice(0, 5)}
                      </span>
                      <span>
                        {s.patientName}
                        {s.chair ? <span style={{ color: 'var(--text-muted)' }}> · cadeira {s.chair}</span> : null}
                        {s.reason && (
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                            {s.reason}
                          </div>
                        )}
                      </span>
                      <span
                        style={{
                          textAlign: 'right',
                          fontWeight: 'var(--weight-bold)',
                          fontVariantNumeric: 'tabular-nums',
                          color: p >= 55 ? 'var(--urgency-critical)' : 'var(--urgency-soon)',
                        }}
                      >
                        {p}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 12, maxWidth: '44rem' }}>
        A percentagem é a probabilidade de o lugar ficar <b>mesmo vazio</b> — já descontada a hipótese de o doente
        avisar a tempo e de alguém da lista de espera o ocupar. É por isso que é menor do que o risco de falta do
        doente, e é este o número que decide se vale um telefonema.
      </p>
    </div>
  );
}
