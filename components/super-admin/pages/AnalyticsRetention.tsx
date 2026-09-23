'use client';
import { daysSinceActivity, retentionBand, type UsageRow } from '@/components/super-admin/usage';
import { Badge, DataTable, Empty, ErrorState, MetricCard, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

const BANDS = [
  { key: 'active', label: 'ATIVAS', sub: 'marcaram nos últimos 7 dias', color: 'var(--urgency-ok)' },
  { key: 'slowing', label: 'A ABRANDAR', sub: 'entre 8 e 30 dias', color: 'var(--urgency-soon)' },
  { key: 'at-risk', label: 'EM RISCO', sub: 'mais de 30 dias sem marcar', color: 'var(--urgency-critical)' },
  { key: 'never', label: 'NUNCA USARAM', sub: 'sem uma única marcação', color: 'var(--text-secondary)' },
];

// Retenção sem contrato: mede-se pelo uso, não pela subscrição.
//
// Não há tabela de subscrições — é decisão de âmbito, não lacuna (ver lib/constants.ts, onde
// as quatro páginas de Faturação foram apagadas em vez de estacionadas: «estacionar uma página
// diz "ainda não"; apagá-la diz "não"»). Por isso não há churn no sentido comercial. O que há —
// e que na prática antecede o churn — é a clínica deixar de marcar. Uma clínica
// dentária que não marca consultas há um mês já saiu, só ainda não avisou.
export default function AnalyticsRetention({ initialData }: { initialData?: UsageRow[] } = {}) {
  const rowsQuery = useQuery<UsageRow[]>('/platform/usage', { initialData });
  const rows = rowsQuery.data ?? null;

  if (rowsQuery.error) return <ErrorState error={rowsQuery.error} onRetry={rowsQuery.refetch} />;
  if (!rows) return <Spinner />;

  const count = (key: string) => rows.filter((r) => retentionBand(r).key === key).length;

  return (
    <div>
      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        {BANDS.map((b) => (
          <MetricCard key={b.key} label={b.label} value={count(b.key)} sub={b.sub} color={b.color} />
        ))}
      </div>

      {!rows.length ? (
        <Empty message="Sem clínicas" />
      ) : (
        <DataTable
          cols={[
            'Clínica',
            'Cidade',
            'Estado de uso',
            'Última marcação',
            'Dias sem marcar',
            'Doentes',
            'Cliente desde',
          ]}
          rows={[...rows]
            // Ordena por quem está pior primeiro: nunca usaram, depois mais dias parados.
            .sort((a, b) => (daysSinceActivity(b) ?? 99_999) - (daysSinceActivity(a) ?? 99_999))
            .map((r) => {
              const band = retentionBand(r);
              const d = daysSinceActivity(r);
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 'var(--weight-semibold)' }}>{r.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.city}</td>
                  <td>
                    <Badge label={band.label} bg={band.bg} color={band.color} />
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {r.last_appointment ? new Date(r.last_appointment).toLocaleDateString('pt-PT') : '—'}
                  </td>
                  <td style={{ fontWeight: 'var(--weight-semibold)', color: band.color }}>{d === null ? '—' : d}</td>
                  <td>{r.patients.toLocaleString('pt-PT')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {new Date(r.created_at).toLocaleDateString('pt-PT')}
                  </td>
                </tr>
              );
            })}
        />
      )}

      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--leading-prose)',
          marginTop: 16,
          maxWidth: 720,
        }}
      >
        Não há churn nem coortes no sentido comercial porque não há modelo de subscrições — nem vai haver, e as páginas
        de faturação da plataforma foram apagadas por isso. Sem contrato não há data de adesão nem de cancelamento; o
        que se mede aqui é o sinal que, de qualquer forma, aparece primeiro: deixar de marcar.
      </p>
    </div>
  );
}
