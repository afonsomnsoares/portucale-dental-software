'use client';
import { AlertTriangle, Building2, CreditCard, Users } from 'lucide-react';
import { AlertBanner, Badge, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { AuditLogEntry, DashboardStats, Tenant } from '@/lib/types';

export default function AdminOverview() {
  // Três painéis independentes. Em Promise.all, qualquer um deles a falhar
  // apagava os outros dois — e o painel da rede é precisamente o ecrã onde
  // interessa ver o que ainda responde.
  const statsQuery = useQuery<DashboardStats>('/dashboard/stats');
  const auditQuery = useQuery<AuditLogEntry[]>('/audit');
  const tenantsQuery = useQuery<Tenant[]>('/tenants');
  const stats = statsQuery.data ?? null;
  const audit = auditQuery.data ?? [];
  const tenants = tenantsQuery.data ?? [];

  const AM: Record<string, { bg: string; color: string }> = {
    UPDATE: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
    CREATE: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
    DELETE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
    PROVISION: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
  };

  return (
    <div>
      {statsQuery.error || tenantsQuery.error ? (
        <AlertBanner type="danger">
          Parte dos números da rede não carregou. {(statsQuery.error || tenantsQuery.error)?.message}
        </AlertBanner>
      ) : null}
      <PageHeader
        title="Visão Geral da Rede"
        sub={new Date().toLocaleDateString('pt-PT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />

      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="CLÍNICAS ATIVAS"
          value={stats?.activeClinics ?? '—'}
          sub={`de ${stats?.totalTenants ?? '—'} no total`}
          color="var(--accent)"
          icon={<Building2 size={22} />}
        />
        <MetricCard
          label="DOENTES NA REDE"
          value={stats ? Number(stats.totalPatients).toLocaleString('pt-PT') : '—'}
          sub="em todas as clínicas"
          color="var(--urgency-ok)"
          icon={<Users size={22} />}
        />
        <MetricCard
          label="POR COBRAR"
          value={stats ? `${Number(stats.outstanding).toLocaleString('pt-PT')} €` : '—'}
          sub="soma de todas as clínicas"
          color="var(--urgency-soon)"
          icon={<CreditCard size={22} />}
        />
        <MetricCard
          label="MARCAÇÕES DE RISCO"
          value={stats?.highRisk ?? '—'}
          sub="a confirmar"
          color="var(--urgency-critical)"
          icon={<AlertTriangle size={22} />}
        />
      </div>

      <div className="grid-split" style={{ gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">AUDITORIA RECENTE</div>
          {auditQuery.error ? (
            <ErrorState
              error={auditQuery.error}
              onRetry={auditQuery.refetch}
              message="Não foi possível ler a atividade."
            />
          ) : !audit.length ? (
            <Spinner />
          ) : (
            audit.slice(0, 6).map((l) => {
              const m = AM[l.action] || AM.UPDATE;
              return (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--bg-page)',
                  }}
                >
                  <Badge label={l.action} bg={m.bg} color={m.color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-medium)',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {l.resource}
                    </div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      {l.user_name} · {l.clinic} · {new Date(l.created_at).toLocaleTimeString('pt-PT')}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--text-2xs)',
                      color: 'var(--text-muted)',
                      fontFamily: '"JetBrains Mono",monospace',
                      flexShrink: 0,
                    }}
                  >
                    #{l.hash}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="card p-5">
          <div className="section-label mb-4">Status</div>
          {tenants.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: '1px solid var(--bg-page)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {t.city?.split(',')[0]}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  {Number(t.patients || 0).toLocaleString('pt-PT')} doentes
                </div>
              </div>
              <Badge s={t.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
