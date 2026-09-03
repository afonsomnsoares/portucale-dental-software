'use client';
import { AlertTriangle, CreditCard, DollarSign, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, GhostBtn, MetricCard, PageHeader, Sel, Spinner } from '@/components/ui';
import type { FinanceData, Tenant } from '@/lib/types';

export default function AdminFinanceDashboard() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api('/tenants')
      .then((t) => {
        setTenants(t || []);
        if ((t || []).length) setTenantId(t[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const params = new URLSearchParams({ tenantId, from, to });
    const res = await api(`/finance/stats?${params.toString()}`).catch(() => null);
    setData(res);
    setLoading(false);
  }, [api, tenantId, from, to]);

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId, load]);

  function fmt(n: number | undefined) {
    return `$${Number(n || 0).toLocaleString()}`;
  }
  function fmtDate(d: string) {
    if (!d) return '—';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div>
      <PageHeader title="Finance Dashboard" sub="Cross-tenant financial performance">
        {loading && !data ? (
          <Spinner />
        ) : (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">— Select tenant —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Sel>
        )}
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
          Refresh
        </GhostBtn>
      </PageHeader>

      {!tenantId ? (
        <div className="card p-5">
          <Empty message="Select a tenant to view financial data" />
        </div>
      ) : !data ? (
        <div className="card p-5">
          <Empty message="No financial data available" />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
            <MetricCard
              label="TOTAL REVENUE"
              value={fmt(data.totals?.total_paid)}
              sub={`${data.totals?.total_invoices || 0} invoices`}
              color="#00875A"
              icon={<TrendingUp />}
            />
            <MetricCard
              label="OUTSTANDING"
              value={fmt(data.totals?.total_outstanding)}
              sub="Unpaid invoice balance"
              color="#DE350B"
              icon={<AlertTriangle />}
            />
            <MetricCard
              label="TOTAL BILLED"
              value={fmt(data.totals?.total_amount)}
              sub="Gross invoice value"
              color="#0052CC"
              icon={<DollarSign />}
            />
            <MetricCard
              label="PATIENT BALANCES"
              value={fmt(data.patientBalance)}
              sub="Sum of patient balances"
              color="#FF8B00"
              icon={<CreditCard />}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card p-5">
              <div className="section-label mb-3">Invoices by Status</div>
              {!data.statusCounts?.length ? (
                <div style={{ color: '#97A0AF', fontSize: 13 }}>No data</div>
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
                        background: '#F8F9FC',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Badge s={s.status} />
                        <span style={{ fontSize: 12, color: '#5E6C84' }}>
                          {s.count} invoice{s.count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono",monospace',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#172B4D',
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
              <div className="section-label mb-3">Revenue by Dentist</div>
              {!data.byDentist?.length ? (
                <div style={{ color: '#97A0AF', fontSize: 13 }}>No data</div>
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
                        background: '#F8F9FC',
                        borderRadius: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D' }}>{d.dentist_name}</div>
                        <div style={{ fontSize: 11, color: '#97A0AF' }}>
                          {d.invoice_count} invoice{d.invoice_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontFamily: '"JetBrains Mono",monospace',
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#172B4D',
                          }}
                        >
                          {fmt(d.total_amount)}
                        </div>
                        <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, color: '#00875A' }}>
                          {fmt(d.total_paid)} collected
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card mt-4 p-5">
            <div className="section-label mb-3">Daily Revenue</div>
            {!data.dailyRevenue?.length ? (
              <div style={{ color: '#97A0AF', fontSize: 13 }}>No revenue data for this period</div>
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
                            background: '#0052CC',
                            borderRadius: '4px 4px 0 0',
                            opacity: 0.7 + (height / 120) * 0.3,
                            transition: 'height 0.2s',
                          }}
                          title={`${fmtDate(d.day)}: ${fmt(d.revenue)}`}
                        />
                        <div
                          style={{
                            fontSize: 9,
                            color: '#97A0AF',
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
            <div className="section-label mb-3">Recent Payments</div>
            {!data.recentPayments?.length ? (
              <div style={{ color: '#97A0AF', fontSize: 13 }}>No payments yet</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #EBECF0' }}>
                    <th className="data-th">Invoice</th>
                    <th className="data-th">Patient</th>
                    <th className="data-th">Date</th>
                    <th className="data-th" style={{ textAlign: 'right' }}>
                      Paid
                    </th>
                    <th className="data-th">Method</th>
                    <th className="data-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #EBECF0' }}>
                      <td className="data-td" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
                        #{p.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {p.patient_name}
                      </td>
                      <td className="data-td" style={{ color: '#5E6C84' }}>
                        {fmtDate(p.invoice_date)}
                      </td>
                      <td
                        className="data-td"
                        style={{
                          textAlign: 'right',
                          fontFamily: '"JetBrains Mono",monospace',
                          fontSize: 12,
                          color: '#00875A',
                        }}
                      >
                        ${Number(p.paid).toLocaleString()}
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
