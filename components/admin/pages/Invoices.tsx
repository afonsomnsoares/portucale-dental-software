'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, PageHeader, Sel, Spinner } from '@/components/ui';
import { basePathFor } from '@/lib/constants';
import type { Invoice, Tenant } from '@/lib/types';

export default function AdminInvoicesPage() {
  const { api } = useAuth();
  // This component mounts at both /dashboard/admin/invoices (role='admin') and
  // /dashboard/platform/invoices (role='super_admin') — see components/admin/pages/ and
  // lib/constants.ts's basePathFor — so the link to the detail page below can't hardcode
  // which tree it's in.
  const basePath = basePathFor(usePathname());
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

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
    const params = new URLSearchParams({ tenantId });
    if (status) params.set('status', status);
    const res = await api(`/invoices?${params.toString()}`).catch(() => []);
    setInvoices(res || []);
  }, [api, tenantId, status]);

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId, load]);

  function fmt(n: number) {
    return `$${Number(n || 0).toLocaleString()}`;
  }
  function fmtDate(d: string | null | undefined) {
    if (!d) return '—';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const totals = invoices.reduce(
    (acc, inv) => ({
      count: acc.count + 1,
      amount: acc.amount + Number(inv.amount),
      paid: acc.paid + Number(inv.paid),
    }),
    { count: 0, amount: 0, paid: 0 },
  );

  return (
    <div>
      <PageHeader title="Invoices" sub="Cross-tenant invoice management">
        {loading ? (
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
        <div className="flex gap-1">
          {['', 'pending', 'partial', 'paid'].map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setStatus(s)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: status === s ? 700 : 500,
                border: '1px solid',
                borderColor: status === s ? '#0052CC' : '#DFE1E6',
                borderRadius: 8,
                background: status === s ? '#DEEBFF' : 'white',
                color: status === s ? '#0052CC' : '#5E6C84',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </PageHeader>

      {!tenantId ? (
        <div className="card p-5">
          <Empty message="Select a tenant to view invoices" />
        </div>
      ) : (
        <div className="card overflow-x-auto p-5">
          <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 12, color: '#97A0AF' }}>Total</span>
              <div style={{ fontWeight: 700 }}>{totals.count}</div>
            </div>
            <div>
              <span style={{ fontSize: 12, color: '#97A0AF' }}>Billed</span>
              <div style={{ fontWeight: 700, fontFamily: '"JetBrains Mono",monospace' }}>{fmt(totals.amount)}</div>
            </div>
            <div>
              <span style={{ fontSize: 12, color: '#97A0AF' }}>Collected</span>
              <div style={{ fontWeight: 700, fontFamily: '"JetBrains Mono",monospace', color: '#00875A' }}>
                {fmt(totals.paid)}
              </div>
            </div>
          </div>

          {!invoices.length ? (
            <Empty message="No invoices found" />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #EBECF0' }}>
                  <th className="data-th">Invoice</th>
                  <th className="data-th">Patient</th>
                  <th className="data-th">Date</th>
                  <th className="data-th" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th className="data-th" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th className="data-th" style={{ textAlign: 'right' }}>
                    Balance
                  </th>
                  <th className="data-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #EBECF0' }}>
                    <td className="data-td" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
                      <Link
                        href={`${basePath}/invoices/${inv.id}`}
                        style={{ color: '#0052CC', fontWeight: 600, textDecoration: 'none' }}
                      >
                        #{inv.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="data-td" style={{ fontWeight: 600 }}>
                      {inv.patient_name}
                    </td>
                    <td className="data-td" style={{ color: '#5E6C84' }}>
                      {fmtDate(inv.invoice_date)}
                    </td>
                    <td
                      className="data-td"
                      style={{ textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
                    >
                      {fmt(inv.amount)}
                    </td>
                    <td
                      className="data-td"
                      style={{
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 12,
                        color: Number(inv.paid) > 0 ? '#00875A' : '#97A0AF',
                      }}
                    >
                      {fmt(inv.paid)}
                    </td>
                    <td
                      className="data-td"
                      style={{
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 12,
                        color: Number(inv.amount) > Number(inv.paid) ? '#DE350B' : '#00875A',
                      }}
                    >
                      {fmt(Math.max(0, Number(inv.amount) - Number(inv.paid)))}
                    </td>
                    <td className="data-td">
                      <Badge s={inv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
