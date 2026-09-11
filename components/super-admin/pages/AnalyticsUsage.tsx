'use client';
import type { UsageRow } from '@/components/super-admin/usage';
import { DataTable, Empty, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

// Utilização = quanto trabalho real passa por esta camada, por clínica.
//
// Não é telemetria de produto (sessões, ecrãs, cliques) — isso não existe e não se
// inventa aqui. É o trabalho medido no que ficou gravado: marcações, equipa ativa,
// doentes, execuções de agentes. Para uma camada de operação, esse é o uso que conta.
export default function AnalyticsUsage() {
  const rowsQuery = useQuery<UsageRow[]>('/platform/usage');
  const rows = rowsQuery.data ?? null;

  if (rowsQuery.error) return <ErrorState error={rowsQuery.error} onRetry={rowsQuery.refetch} />;
  if (!rows) return <Spinner />;

  const appts30 = rows.reduce((a, r) => a + r.appts_30d, 0);
  const apptsPrev = rows.reduce((a, r) => a + r.appts_prev_30d, 0);
  // Variação face aos 30 dias anteriores. Sem base anterior não há percentagem que
  // signifique alguma coisa — mostra-se um travessão em vez de um 100% enganador.
  const delta = apptsPrev ? Math.round(((appts30 - apptsPrev) / apptsPrev) * 100) : null;
  const runs = rows.reduce((a, r) => a + r.agent_runs_7d, 0);

  return (
    <div>
      <PageHeader title="Utilização" sub="Trabalho real por clínica, últimos 30 dias" />

      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="MARCAÇÕES 30D"
          value={appts30.toLocaleString('pt-PT')}
          sub="em toda a rede"
          color="var(--accent)"
        />
        <MetricCard
          label="VARIAÇÃO"
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
          sub="face aos 30 dias anteriores"
          color={delta !== null && delta < 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
        />
        <MetricCard
          label="EQUIPA ATIVA"
          value={rows.reduce((a, r) => a + r.active_users, 0)}
          sub="contas ativas na rede"
          color="var(--cat-purple)"
        />
        <MetricCard label="EXECUÇÕES 7D" value={runs} sub="passagens de agentes" color="var(--urgency-ok)" />
      </div>

      {!rows.length ? (
        <Empty message="Sem clínicas" />
      ) : (
        <DataTable
          cols={['Clínica', 'Doentes', 'Equipa', 'Marcações 30d', '30d anteriores', 'Variação', 'Agentes 7d']}
          rows={[...rows]
            .sort((a, b) => b.appts_30d - a.appts_30d)
            .map((r) => {
              const d = r.appts_prev_30d
                ? Math.round(((r.appts_30d - r.appts_prev_30d) / r.appts_prev_30d) * 100)
                : null;
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{r.patients.toLocaleString('pt-PT')}</td>
                  <td>{r.active_users}</td>
                  <td style={{ fontWeight: 600 }}>{r.appts_30d}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.appts_prev_30d}</td>
                  <td
                    style={{
                      color: d === null ? 'var(--text-muted)' : d < 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)',
                      fontWeight: 600,
                    }}
                  >
                    {d === null ? '—' : `${d > 0 ? '+' : ''}${d}%`}
                  </td>
                  <td style={{ color: r.agent_runs_7d ? 'var(--text-primary)' : 'var(--urgency-critical)' }}>
                    {r.agent_runs_7d}
                  </td>
                </tr>
              );
            })}
        />
      )}

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        Uma clínica com marcações e zero execuções de agentes na coluna final é o caso a investigar: está a usar o
        sistema como registo e não como camada de decisão, que é exatamente o que este produto não quer ser.
      </p>
    </div>
  );
}
