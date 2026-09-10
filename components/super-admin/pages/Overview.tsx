'use client';
import { AlertTriangle, Building2, CreditCard, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, MetricCard, PageHeader, Spinner } from '@/components/ui';
import type { AuditLogEntry, DashboardStats, Tenant } from '@/lib/types';

export default function AdminOverview() {
  const { api } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    Promise.all([
      api('/dashboard/stats').catch(() => null),
      api('/audit').catch(() => []),
      api('/tenants').catch(() => []),
    ]).then(([s, a, t]) => {
      if (s) setStats(s);
      setAudit(a || []);
      setTenants(t || []);
    });
  }, [api]);

  const AM: Record<string, { bg: string; color: string }> = {
    UPDATE: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
    CREATE: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
    DELETE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
    PROVISION: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
  };

  return (
    <div>
      <PageHeader
        title="Visão Geral da Rede"
        sub={new Date().toLocaleDateString('pt-PT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">AUDITORIA RECENTE</div>
          {!audit.length ? (
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
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {l.resource}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {l.user_name} · {l.clinic} · {new Date(l.created_at).toLocaleTimeString('pt-PT')}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
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
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {t.city?.split(',')[0]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
