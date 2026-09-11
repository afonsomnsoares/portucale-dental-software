'use client';
import { Badge, Empty, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface RoleRow {
  role: string;
  label: string;
  sub: string;
  users: number;
  activeUsers: number;
  clinics: number;
  defaultActions: number;
  overrides: Array<{ action: string; allowed: boolean; tenantName: string | null; deviates: boolean }>;
}

export default function Roles() {
  const dataQuery = useQuery<{ roles: RoleRow[]; totalActions: number }>('/platform/roles');
  const data = dataQuery.data ?? null;

  if (dataQuery.error) return <ErrorState error={dataQuery.error} onRetry={dataQuery.refetch} />;
  if (!data) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Papéis"
        sub={`${data.roles.length} papéis · ${data.totalActions} ações declaradas no sistema`}
      />

      {data.roles.map((r) => {
        // Só os desvios interessam: uma clínica que gravou uma linha igual à omissão
        // não mudou nada, e listá-la enterrava as que mudaram mesmo.
        const deviations = r.overrides.filter((o) => o.deviates);
        const byClinic = new Map<string, typeof deviations>();
        for (const d of deviations) {
          const k = d.tenantName || 'Clínica removida';
          byClinic.set(k, [...(byClinic.get(k) || []), d]);
        }

        return (
          <div key={r.role} className="card p-5" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    fontFamily: '"JetBrains Mono",monospace',
                  }}
                >
                  {r.role} · {r.sub}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--text-primary)' }}
                >
                  {r.activeUsers}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  {r.users === r.activeUsers ? 'pessoas' : `ativas de ${r.users}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 90 }}>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--accent)' }}>
                  {r.defaultActions}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>ações por omissão</div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 80 }}>
                <div
                  style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--cat-purple)' }}
                >
                  {r.clinics}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>clínicas</div>
              </div>
            </div>

            {!byClinic.size ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                Nenhuma clínica alterou as permissões deste papel — todas correm com a omissão.
              </div>
            ) : (
              <>
                <div className="section-label mb-2">
                  DESVIOS À OMISSÃO ({deviations.length} em {byClinic.size} clínicas)
                </div>
                {[...byClinic.entries()].map(([clinic, items]) => (
                  <div key={clinic} style={{ padding: '8px 0', borderBottom: '1px solid var(--bg-page)' }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--text-primary)',
                        marginBottom: 4,
                      }}
                    >
                      {clinic}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {items.map((d) => (
                        <Badge
                          key={d.action}
                          label={`${d.allowed ? '+' : '−'} ${d.action}`}
                          bg={d.allowed ? 'var(--urgency-ok-bg)' : 'var(--urgency-critical-bg)'}
                          color={d.allowed ? 'var(--urgency-ok)' : 'var(--urgency-critical)'}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}

      {!data.roles.length && <Empty message="Sem papéis" />}

      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
          marginTop: 16,
          maxWidth: 720,
        }}
      >
        Os quatro papéis são fixos: estão no tipo (lib/constants.ts), na restrição CHECK da base de dados e no
        middleware, e os três têm de concordar. O que cada clínica pode mudar é o que cada papel FAZ — é isso que está
        acima como desvio, e edita-se em Permissões.
      </p>
    </div>
  );
}
