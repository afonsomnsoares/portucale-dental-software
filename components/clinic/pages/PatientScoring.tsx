'use client';
// ─── Análise de doentes ─────────────────────────────────────────────────────
// Os três scorings de lib/patientScoringCalc.ts — envolvimento, risco de abandono e
// probabilidade de marcação — que tinham rota, testes e nenhuma página.
//
// ─── Porque é que nenhum número aparece sozinho ─────────────────────────────
// `topDrivers` existe precisamente para isto: devolve os fatores que mais pesaram, com
// os pontos de cada um. Um score nu («risco de abandono: 72») não é acionável e é pior
// do que inútil — parece objetivo e não se pode discordar dele. Com os fatores à vista,
// quem lê pode dizer «isso é do saldo em atraso, já está resolvido» e ter razão.
//
// A ordenação por omissão é a `priority` que o próprio lib/patientScoring.ts calcula:
// risco × probabilidade de marcação, ou seja a ordem por que vale a pena telefonar. Não
// é ordenar por risco — o doente com 95 de risco e 5 de probabilidade é tempo perdido.
import { useState } from 'react';
import { Empty, PageHeader, Sel, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

type Band = 'baixo' | 'medio' | 'alto';
interface Driver {
  key: string;
  label: string;
  points: number;
}
interface Score {
  score: number;
  band: Band;
  drivers: Driver[];
  suppressed?: string;
}
interface ScoredPatient {
  patientId: string;
  name: string;
  phone: string | null;
  priority: number;
  scores: { engagement: Score; churnRisk: Score; bookingPropensity: Score };
}

// O envolvimento é bom quando é alto; o risco de abandono é mau quando é alto. A mesma
// escala com sentidos opostos — pintar as duas da mesma maneira seria mentir.
const TOM: Record<Band, string> = {
  alto: 'var(--urgency-ok)',
  medio: 'var(--urgency-soon)',
  baixo: 'var(--text-muted)',
};
const TOM_INVERSO: Record<Band, string> = {
  alto: 'var(--urgency-critical)',
  medio: 'var(--urgency-soon)',
  baixo: 'var(--urgency-ok)',
};

function Medidor({ s, invertido = false }: { s: Score; invertido?: boolean }) {
  const cor = (invertido ? TOM_INVERSO : TOM)[s.band];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: cor, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/100</span>
      </div>
      <div style={{ height: 3, background: 'var(--bg-sunken)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
        <div style={{ width: `${s.score}%`, height: '100%', background: cor }} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>
        {s.suppressed ? s.suppressed : s.drivers.length ? s.drivers.map((d) => d.label).join(' · ') : 'Sem sinal forte'}
      </div>
    </div>
  );
}

// `initialData` vem da página do servidor, que já calculou os scores. Ordenar é
// interação e fica no cliente: é reordenar um array que já está na memória.
export default function PatientScoring({ initialData }: { initialData?: { patients: ScoredPatient[] } } = {}) {
  const [ordem, setOrdem] = useState<'priority' | 'churnRisk' | 'engagement' | 'bookingPropensity'>('priority');
  const consulta = useQuery<{ patients: ScoredPatient[] }>('/patient-scoring?limit=200', { initialData });
  const doentes = consulta.data?.patients ?? [];
  const aCarregar = consulta.loading;
  const erro = consulta.error?.message ?? '';

  const ordenados = [...doentes].sort((a, b) =>
    ordem === 'priority' ? b.priority - a.priority : b.scores[ordem].score - a.scores[ordem].score,
  );

  return (
    <div>
      <PageHeader
        title="Análise de Doentes"
        sub="Três leituras da mesma carteira, sempre com os fatores que as explicam. Nada disto é guardado — é recalculado a cada visita."
      >
        <Sel value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} style={{ width: 210 }}>
          <option value="priority">Por quem telefonar primeiro</option>
          <option value="churnRisk">Por risco de abandono</option>
          <option value="engagement">Por envolvimento</option>
          <option value="bookingPropensity">Por probabilidade de marcar</option>
        </Sel>
      </PageHeader>

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {aCarregar ? (
        <Spinner />
      ) : ordenados.length === 0 ? (
        <Empty message="Ainda não há doentes com historial que chegue para pontuar." />
      ) : (
        <>
          {ordem === 'priority' && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', maxWidth: '46rem' }}>
              A ordem é risco de abandono × probabilidade de marcar. Quem tem risco altíssimo e nenhuma probabilidade de
              voltar não está no topo de propósito: é tempo de telefone gasto sem retorno.
            </p>
          )}
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--bg-surface)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  {['Doente', 'Envolvimento', 'Risco de abandono', 'Probabilidade de marcar'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '9px 14px',
                        fontSize: 10.5,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        fontWeight: 500,
                        borderBottom: '1px solid var(--border-strong)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordenados.map((p) => (
                  <tr key={p.patientId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '11px 14px', verticalAlign: 'top', minWidth: 170 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                      {p.phone && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.phone}</div>}
                    </td>
                    <td style={{ padding: '11px 14px', verticalAlign: 'top', minWidth: 175 }}>
                      <Medidor s={p.scores.engagement} />
                    </td>
                    <td style={{ padding: '11px 14px', verticalAlign: 'top', minWidth: 175 }}>
                      <Medidor s={p.scores.churnRisk} invertido />
                    </td>
                    <td style={{ padding: '11px 14px', verticalAlign: 'top', minWidth: 175 }}>
                      <Medidor s={p.scores.bookingPropensity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
