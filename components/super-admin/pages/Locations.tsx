'use client';
import { retentionBand, type UsageRow } from '@/components/super-admin/usage';
import { Badge, Empty, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

// ─── Uma nota sobre o modelo de dados ───────────────────────────────────────
// A estrutura pedida separa "Organizações" de "Localizações", que é o modelo de um
// grupo com várias clínicas por marca. O schema desta aplicação não tem esse nível:
// `tenants` é ao mesmo tempo a organização e o sítio (tem name E city, uma linha por
// clínica física). Ver scripts/schema.sql.
//
// Esta página não finge que a hierarquia existe. Agrupa as clínicas por CIDADE, que é
// a única dimensão geográfica real que há hoje, e diz o que faltaria para ser a página
// pedida. Inventar uma organização-mãe aqui obrigaria a decidir sozinho um modelo de
// dados que ainda não foi decidido.
export default function Locations() {
  const rowsQuery = useQuery<UsageRow[]>('/platform/usage');
  const rows = rowsQuery.data ?? null;

  if (rowsQuery.error) return <ErrorState error={rowsQuery.error} onRetry={rowsQuery.refetch} />;
  if (!rows) return <Spinner />;

  const byCity = new Map<string, UsageRow[]>();
  for (const r of rows) {
    // A cidade vem escrita à mão em tenants.city e às vezes traz distrito a seguir
    // a uma vírgula — agrupa-se pelo primeiro segmento, que é o que Overview já faz.
    const city = (r.city || 'Sem cidade').split(',')[0].trim();
    byCity.set(city, [...(byCity.get(city) || []), r]);
  }
  const cities = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <PageHeader title="Localizações" sub={`${rows.length} clínicas em ${cities.length} cidades`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard label="CIDADES" value={cities.length} sub="com pelo menos uma clínica" color="var(--accent)" />
        <MetricCard
          label="GABINETES"
          value={rows.reduce((a, r) => a + r.operatories, 0)}
          sub="capacidade instalada na rede"
          color="var(--cat-purple)"
        />
        <MetricCard
          label="MAIOR CIDADE"
          value={cities[0]?.[0] || '—'}
          sub={cities[0] ? `${cities[0][1].length} clínicas` : ''}
          color="var(--urgency-ok)"
        />
      </div>

      {!cities.length ? (
        <Empty message="Nenhuma clínica na rede" />
      ) : (
        cities.map(([city, clinics]) => (
          <div key={city} className="card p-5" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{city}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {clinics.length} {clinics.length === 1 ? 'clínica' : 'clínicas'} ·{' '}
                {clinics.reduce((a, c) => a + c.operatories, 0)} gabinetes ·{' '}
                {clinics.reduce((a, c) => a + c.patients, 0).toLocaleString('pt-PT')} doentes
              </span>
            </div>
            {clinics.map((c) => {
              const band = retentionBand(c);
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 0',
                    borderBottom: '1px solid var(--bg-page)',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.operatories} gab.</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {c.patients.toLocaleString('pt-PT')} doentes
                  </span>
                  <Badge label={band.label} bg={band.bg} color={band.color} />
                  <Badge s={c.status} />
                </div>
              );
            })}
          </div>
        ))
      )}

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        Agrupado por cidade porque é a única geografia que o schema tem: `tenants` é ao mesmo tempo a organização e o
        sítio. Para esta página ser mesmo «localizações de uma organização» faltaria uma tabela de organizações acima de
        `tenants`, com as clínicas a apontar para ela — uma decisão de modelo de dados, não de ecrã.
      </p>
    </div>
  );
}
