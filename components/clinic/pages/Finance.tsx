'use client';
import { AlertTriangle, CreditCard, DollarSign, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, GhostBtn, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';
import type { FinanceData } from '@/lib/types';

// Painel financeiro da própria clínica. A versão de plataforma
// (components/super-admin/pages/Finance.tsx) compara tenants e obriga a escolher um; aqui
// app/api/finance/stats/route.ts já ignora ?tenantId= para quem não é super_admin e usa
// sempre user.tenantId, por isso a página carrega direta e mostra valores em euros.
export default function ClinicFinanceDashboard() {
  const { api } = useAuth();
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    const res = await api(`/finance/stats?${params.toString()}`).catch(() => null);
    setData(res);
    setLoading(false);
  }, [api, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function fmt(n: number | undefined) {
    return formatEUR(Number(n || 0));
  }
  function fmtDate(d: string) {
    if (!d) return '—';
    return new Date(`${d}T00:00:00`).toLocaleDateString('pt-PT', { month: 'short', day: 'numeric' });
  }

  return (
    <div>
      <PageHeader title="Finanças" sub="Desempenho financeiro da clínica">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="input"
          style={{ width: 140, fontSize: 12, padding: '6px 10px' }}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input"
          style={{ width: 140, fontSize: 12, padding: '6px 10px' }}
        />
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {loading && !data ? (
        <div className="card p-5">
          <Spinner />
        </div>
      ) : !data ? (
        <div className="card p-5">
          <Empty message="Sem dados financeiros para este período." />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
            <MetricCard
              label="RECEITA COBRADA"
              value={fmt(data.totals?.total_paid)}
              sub={`${data.totals?.total_invoices || 0} faturas`}
              color="var(--urgency-ok)"
              icon={<TrendingUp />}
            />
            <MetricCard
              label="POR COBRAR"
              value={fmt(data.totals?.total_outstanding)}
              sub="Saldo de faturas por liquidar"
              color="var(--urgency-critical)"
              icon={<AlertTriangle />}
            />
            <MetricCard
              label="TOTAL FATURADO"
              value={fmt(data.totals?.total_amount)}
              sub="Valor bruto faturado"
              color="var(--accent)"
              icon={<DollarSign />}
            />
            <MetricCard
              label="SALDOS DE DOENTES"
              value={fmt(data.patientBalance)}
              sub="Soma dos saldos por doente"
              color="var(--urgency-soon)"
              icon={<CreditCard />}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card p-5">
              <div className="section-label mb-3">FATURAS POR ESTADO</div>
              {!data.statusCounts?.length ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sem dados</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.statusCounts.map((s: { status: string; count: number; amount: number }) => (
                    <div
                      key={s.status}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--bg-page)',
                        borderRadius: 'var(--radius-control)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Badge s={s.status} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {s.count} {s.count === 1 ? 'fatura' : 'faturas'}
                        </span>
                      </div>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono",monospace',
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {fmt(s.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="section-label mb-3">RECEITA POR MÉDICO DENTISTA</div>
              {!data.byDentist?.length ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sem dados</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.byDentist.map((d) => (
                    <div
                      key={d.dentist_name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--bg-page)',
                        borderRadius: 'var(--radius-control)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {d.dentist_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {d.invoice_count} {d.invoice_count === 1 ? 'fatura' : 'faturas'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontFamily: '"JetBrains Mono",monospace',
                            fontSize: 13,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {fmt(d.total_amount)}
                        </div>
                        <div
                          style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, color: 'var(--urgency-ok)' }}
                        >
                          {fmt(d.total_paid)} cobrado
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card mt-4 p-5">
            <div className="section-label mb-3">RECEITA DIÁRIA</div>
            {!data.dailyRevenue?.length ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sem receita registada neste período</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'flex', gap: 4, minWidth: data.dailyRevenue.length * 40 }}>
                  {data.dailyRevenue.map((d) => {
                    const maxRevenue = Math.max(...(data.dailyRevenue || []).map((r) => Number(r.revenue)));
                    const height = maxRevenue > 0 ? (Number(d.revenue) / maxRevenue) * 120 : 0;
                    return (
                      <div
                        key={d.day}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                          flex: 1,
                          minWidth: 36,
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: Math.max(4, height),
                            background: 'var(--accent)',
                            borderRadius: 'var(--radius-control) var(--radius-control) 0 0',
                            opacity: 0.7 + (height / 120) * 0.3,
                            transition: 'height 0.2s',
                          }}
                          title={`${fmtDate(d.day)}: ${fmt(d.revenue)}`}
                        />
                        <div
                          style={{
                            fontSize: 9,
                            color: 'var(--text-muted)',
                            fontFamily: '"JetBrains Mono",monospace',
                            transform: 'rotate(-45deg)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {fmtDate(d.day)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="card mt-4 p-5">
            <div className="section-label mb-3">PAGAMENTOS RECENTES</div>
            {!data.recentPayments?.length ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sem pagamentos registados</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--bg-sunken)' }}>
                    <th className="data-th">Fatura</th>
                    <th className="data-th">Doente</th>
                    <th className="data-th">Data</th>
                    <th className="data-th" style={{ textAlign: 'right' }}>
                      Pago
                    </th>
                    <th className="data-th">Método</th>
                    <th className="data-th">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--bg-sunken)' }}>
                      <td className="data-td" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
                        #{p.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {p.patient_name}
                      </td>
                      <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(p.invoice_date)}
                      </td>
                      <td
                        className="data-td"
                        style={{
                          textAlign: 'right',
                          fontFamily: '"JetBrains Mono",monospace',
                          fontSize: 12,
                          color: 'var(--urgency-ok)',
                        }}
                      >
                        {fmt(p.paid)}
                      </td>
                      <td className="data-td" style={{ fontSize: 12 }}>
                        {p.method}
                      </td>
                      <td className="data-td">
                        <Badge s={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
