'use client';
import { AlertTriangle, CreditCard, DollarSign, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, GhostBtn, MetricCard, PageHeader, Spinner } from '@/components/ui';
import type { FinanceData } from '@/lib/types';

export default function FinanceDashboard() {
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

  const outstandingByStatus = useMemo(() => {
    if (!data?.statusCounts) return [];
    return data.statusCounts;
  }, [data]);

  function fmt(n: number | undefined) {
    return `$${Number(n || 0).toLocaleString()}`;
  }
  function fmtDate(d: string) {
    if (!d) return '—';
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Finance Dashboard" sub="Revenue, outstanding balances, and financial performance">
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

      {!data ? (
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
              sub={`${fmt(data.patientBalance)} patient balances`}
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
              sub="Sum of all patient balances"
              color="#FF8B00"
              icon={<CreditCard />}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card p-5">
              <div className="section-label mb-3">Invoices by Status</div>
              {!outstandingByStatus.length ? (
                <div style={{ color: '#97A0AF', fontSize: 13 }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {outstandingByStatus.map((s) => (
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
                        <Link
                          href={`/dashboard/receptionist/invoices/${p.id}`}
                          style={{ color: '#0052CC', fontWeight: 600, textDecoration: 'none' }}
                        >
                          #{p.id.slice(0, 8).toUpperCase()}
                        </Link>
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
