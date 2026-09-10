'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { retentionBand, type UsageRow } from '@/components/super-admin/usage';
import { Badge, DataTable, Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';

// "Todas as Organizações" é a vista de CARTEIRA: cada clínica com o seu tamanho, o seu
// uso e o seu estado, ordenada por quem mais pesa. A vista operacional de uma clínica
// (criar, provisionar, entrar) continua em Clínicas — são trabalhos diferentes e por
// isso são páginas diferentes, com a mesma fonte de dados.
export default function Organizations() {
  const { api } = useAuth();
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    api('/platform/usage')
      .then(setRows)
      .catch(() => setRows([]));
  }, [api]);

  if (!rows) return <Spinner />;

  const active = rows.filter((r) => r.status === 'active').length;
  const patients = rows.reduce((a, r) => a + r.patients, 0);
  const users = rows.reduce((a, r) => a + r.active_users, 0);
  const atRisk = rows.filter((r) => ['at-risk', 'never'].includes(retentionBand(r).key)).length;

  return (
    <div>
      <PageHeader title="Todas as Organizações" sub={`${rows.length} clínicas na rede`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard label="ATIVAS" value={active} sub={`de ${rows.length}`} color="var(--urgency-ok)" />
        <MetricCard
          label="DOENTES"
          value={patients.toLocaleString('pt-PT')}
          sub="em toda a rede"
          color="var(--accent)"
        />
        <MetricCard label="UTILIZADORES" value={users} sub="com conta ativa" color="var(--cat-purple)" />
        <MetricCard
          label="SEM USO RECENTE"
          value={atRisk}
          sub="30+ dias sem marcações"
          color="var(--urgency-critical)"
        />
      </div>

      {!rows.length ? (
        <Empty message="Nenhuma clínica na rede" />
      ) : (
        <DataTable
          cols={['Clínica', 'Cidade', 'Estado', 'Doentes', 'Equipa', 'Gabinetes', 'Marcações 30d', 'Uso', 'Desde']}
          rows={[...rows]
            .sort((a, b) => b.patients - a.patients)
            .map((r) => {
              const band = retentionBand(r);
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.city}</td>
                  <td>
                    <Badge s={r.status} />
                  </td>
                  <td>{r.patients.toLocaleString('pt-PT')}</td>
                  <td>{r.active_users}</td>
                  <td>{r.operatories}</td>
                  <td>{r.appts_30d}</td>
                  <td>
                    <Badge label={band.label} bg={band.bg} color={band.color} />
                  </td>
                  <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleDateString('pt-PT')}
                  </td>
                </tr>
              );
            })}
        />
      )}
    </div>
  );
}
