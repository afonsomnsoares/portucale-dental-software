'use client';
import { AlertTriangle, CalendarCheck, CreditCard, Users } from 'lucide-react';
import { useAuth } from '@/app/providers';
import { AlertBanner, Badge, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';
import type { AuditLogEntry, DashboardStats } from '@/lib/types';

// Visão geral do admin da CLÍNICA. A versão de plataforma
// (components/super-admin/pages/Overview.tsx) mostra o estado da rede — nº de clínicas
// ativas, doentes de todas elas, painel de status por tenant. Nada disso existe aqui:
// um admin de clínica só tem uma clínica, e /api/tenants devolve-lhe 403 de propósito
// (ver requireSuperAdmin em app/api/tenants/route.ts).
export default function ClinicOverview() {
  const { user } = useAuth();
  // Ambas as rotas já se limitam ao tenant de quem chama (o filtro `user.tenantId` em
  // app/api/dashboard/stats/route.ts, o `clinic` forçado em app/api/audit/route.ts),
  // por isso não há nada a passar nem a filtrar do lado do cliente.
  //
  // Dois useQuery e não um Promise.all: são dois painéis independentes, e um
  // Promise.all dá-lhes um destino único — a atividade recente a falhar apagaria
  // os números do topo.
  const stats = useQuery<DashboardStats>('/dashboard/stats');
  const audit = useQuery<AuditLogEntry[]>('/audit');

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

      {/* Um traço num cartão de métrica lê-se como «zero», não como «não sei».
          Enquanto os números não vierem, é preciso dizê-lo por palavras. */}
      {stats.error ? (
        <AlertBanner type="danger">
          Não foi possível ler os números da clínica. {stats.error.message}{' '}
          <button
            type="button"
            onClick={stats.refetch}
            style={{ textDecoration: 'underline', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          >
            Tentar novamente
          </button>
        </AlertBanner>
      ) : null}

      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="DOENTES"
          value={stats.data ? Number(stats.data.totalPatients).toLocaleString('pt-PT') : '—'}
          sub="registados na clínica"
          color="var(--urgency-ok)"
          icon={<Users size={22} />}
        />
        <MetricCard
          label="SALDO POR COBRAR"
          value={stats.data ? formatEUR(Number(stats.data.outstanding)) : '—'}
          sub="total em dívida"
          color="var(--urgency-soon)"
          icon={<CreditCard size={22} />}
        />
        <MetricCard
          label="MARCAÇÕES DE RISCO"
          value={stats.data?.highRisk ?? '—'}
          sub="hoje — confirmar presença"
          color="var(--urgency-critical)"
          icon={<AlertTriangle size={22} />}
        />
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">ATIVIDADE RECENTE</div>
        {audit.loading ? (
          <Spinner />
        ) : audit.error ? (
          <ErrorState error={audit.error} onRetry={audit.refetch} message="Não foi possível ler a atividade recente." />
        ) : !audit.data?.length ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <CalendarCheck size={16} />
            Sem atividade registada.
          </div>
        ) : (
          audit.data.slice(0, 10).map((l) => {
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
                    {l.user_name} · {new Date(l.created_at).toLocaleTimeString('pt-PT')}
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
    </div>
  );
}
