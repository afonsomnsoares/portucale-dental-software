'use client';
import { AlertTriangle, CalendarCheck, CreditCard, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';
import type { AuditLogEntry, DashboardStats } from '@/lib/types';

// Visão geral do admin da CLÍNICA. A versão de plataforma
// (components/super-admin/pages/Overview.tsx) mostra o estado da rede — nº de clínicas
// ativas, doentes de todas elas, painel de status por tenant. Nada disso existe aqui:
// um admin de clínica só tem uma clínica, e /api/tenants devolve-lhe 403 de propósito
// (ver requireSuperAdmin em app/api/tenants/route.ts).
export default function ClinicOverview() {
  const { api, user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ambas as rotas já se limitam ao tenant de quem chama (o filtro `user.tenantId` em
    // app/api/dashboard/stats/route.ts, o `clinic` forçado em app/api/audit/route.ts),
    // por isso não há nada a passar nem a filtrar do lado do cliente.
    Promise.all([api('/dashboard/stats').catch(() => null), api('/audit').catch(() => [])])
      .then(([s, a]) => {
        if (s) setStats(s);
        setAudit(a || []);
      })
      .finally(() => setLoading(false));
  }, [api]);

  const AM: Record<string, { bg: string; color: string }> = {
    UPDATE: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
    CREATE: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
    DELETE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
    PROVISION: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
  };

  const hoje = new Date().toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div>
      <PageHeader title="Visão Geral" sub={`${user?.tenantName || user?.clinic || 'Clínica'} — ${hoje}`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="DOENTES"
          value={stats ? Number(stats.totalPatients).toLocaleString('pt-PT') : '—'}
          sub="registados na clínica"
          color="var(--urgency-ok)"
          icon={<Users size={22} />}
        />
        <MetricCard
          label="SALDO POR COBRAR"
          value={stats ? formatEUR(Number(stats.outstanding)) : '—'}
          sub="total em dívida"
          color="var(--urgency-soon)"
          icon={<CreditCard size={22} />}
        />
        <MetricCard
          label="MARCAÇÕES DE RISCO"
          value={stats?.highRisk ?? '—'}
          sub="hoje — confirmar presença"
          color="var(--urgency-critical)"
          icon={<AlertTriangle size={22} />}
        />
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">ATIVIDADE RECENTE</div>
        {loading ? (
          <Spinner />
        ) : !audit.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
            <CalendarCheck size={16} />
            Sem atividade registada.
          </div>
        ) : (
          audit.slice(0, 10).map((l) => {
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
                    {l.user_name} · {new Date(l.created_at).toLocaleTimeString('pt-PT')}
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
    </div>
  );
}
