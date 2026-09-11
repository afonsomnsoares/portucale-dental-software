'use client';
import { daysSinceActivity, retentionBand, type UsageRow } from '@/components/super-admin/usage';
import { Badge, DataTable, Empty, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

const BANDS = [
  { key: 'active', label: 'ATIVAS', sub: 'marcaram nos últimos 7 dias', color: 'var(--urgency-ok)' },
  { key: 'slowing', label: 'A ABRANDAR', sub: 'entre 8 e 30 dias', color: 'var(--urgency-soon)' },
  { key: 'at-risk', label: 'EM RISCO', sub: 'mais de 30 dias sem marcar', color: 'var(--urgency-critical)' },
  { key: 'never', label: 'NUNCA USARAM', sub: 'sem uma única marcação', color: 'var(--text-secondary)' },
];

// Retenção sem contrato: mede-se pelo uso, não pela subscrição.
//
// Não há tabela de subscrições, por isso não há churn no sentido comercial. O que há —
// e que na prática antecede o churn — é a clínica deixar de marcar. Uma clínica
// dentária que não marca consultas há um mês já saiu, só ainda não avisou.
export default function AnalyticsRetention() {
  const rowsQuery = useQuery<UsageRow[]>('/platform/usage');
  const rows = rowsQuery.data ?? null;

  if (rowsQuery.error) return <ErrorState error={rowsQuery.error} onRetry={rowsQuery.refetch} />;
  if (!rows) return <Spinner />;

  const count = (key: string) => rows.filter((r) => retentionBand(r).key === key).length;

  return (
    <div>
      <PageHeader title="Retenção" sub="Medida por atividade real, não por contrato" />

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
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.city}</td>
                  <td>
                    <Badge label={band.label} bg={band.bg} color={band.color} />
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {r.last_appointment ? new Date(r.last_appointment).toLocaleDateString('pt-PT') : '—'}
                  </td>
                  <td style={{ fontWeight: 600, color: band.color }}>{d === null ? '—' : d}</td>
                  <td>{r.patients.toLocaleString('pt-PT')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {new Date(r.created_at).toLocaleDateString('pt-PT')}
                  </td>
                </tr>
              );
            })}
        />
      )}

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        Para haver churn e coortes no sentido comercial faltaria a tabela de subscrições (ver Faturação → Subscrições):
        quando cada clínica assinou, por quanto, e quando cancelou. Isto mede o sinal que aparece primeiro.
      </p>
    </div>
  );
}
