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
    UPDATE: { bg: '#FFF7E6', color: '#FF8B00' },
    CREATE: { bg: '#E3FCEF', color: '#00875A' },
    DELETE: { bg: '#FFEBE6', color: '#DE350B' },
    PROVISION: { bg: '#EAE6FF', color: '#5243AA' },
  };

  return (
    <div>
      <PageHeader
        title="Enterprise Overview"
        sub={`Network health dashboard — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="ACTIVE CLINICS"
          value={stats?.activeClinics ?? '—'}
          sub={`of ${stats?.totalTenants ?? '—'} total`}
          color="#0052CC"
          icon={<Building2 size={22} />}
        />
        <MetricCard
          label="GLOBAL PATIENTS"
          value={stats ? Number(stats.totalPatients).toLocaleString() : '—'}
          sub="+142 this month"
          color="#00875A"
          icon={<Users size={22} />}
        />
        <MetricCard
          label="OUTSTANDING BALANCE"
          value={stats ? `$${Number(stats.outstanding).toLocaleString()}` : '—'}
          sub="across all clinics"
          color="#FF8B00"
          icon={<CreditCard size={22} />}
        />
        <MetricCard
          label="HIGH-RISK APPTS"
          value={stats?.highRisk ?? '—'}
          sub="require confirmation"
          color="#DE350B"
          icon={<AlertTriangle size={22} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">RECENT AUDIT ACTIVITY</div>
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
                    borderBottom: '1px solid #F4F7FA',
                  }}
                >
                  <Badge label={l.action} bg={m.bg} color={m.color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#172B4D',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {l.resource}
                    </div>
                    <div style={{ fontSize: 11, color: '#97A0AF' }}>
                      {l.user_name} · {l.clinic} · {new Date(l.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <div
                    style={{ fontSize: 10, color: '#C1C7D0', fontFamily: '"JetBrains Mono",monospace', flexShrink: 0 }}
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
                borderBottom: '1px solid #F4F7FA',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#172B4D' }}>{t.city?.split(',')[0]}</div>
                <div style={{ fontSize: 11, color: '#97A0AF' }}>
                  {Number(t.patients || 0).toLocaleString()} patients
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
