'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, PageHeader, Spinner } from '@/components/ui';
import { formatDatePT, formatEUR } from '@/lib/constants';
import type { Invoice } from '@/lib/types';

const STATUS_LABELS: Array<[value: string, label: string]> = [
  ['', 'Todas'],
  ['pending', 'Pendentes'],
  ['partial', 'Parciais'],
  ['paid', 'Pagas'],
];

// Faturação da própria clínica. A versão de plataforma
// (components/super-admin/pages/Invoices.tsx) escolhe a clínica primeiro; aqui
// app/api/invoices/route.ts já confina o resultado a user.tenantId, por isso não se passa
// ?tenantId= nenhum. Como esta cópia só monta em /dashboard/admin, o link para o detalhe
// pode ser fixo — não precisa do basePathFor que a versão partilhada exigia.
export default function ClinicInvoicesPage() {
  const { api } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    const res = await api(`/invoices${qs ? `?${qs}` : ''}`).catch(() => []);
    setInvoices(res || []);
    setLoading(false);
  }, [api, status]);

  useEffect(() => {
    load();
  }, [load]);

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
      <PageHeader title="Faturas" sub="Faturação da clínica">
        <div className="flex gap-1">
          {STATUS_LABELS.map(([value, label]) => (
            <button
              type="button"
              key={value || 'all'}
              onClick={() => setStatus(value)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: status === value ? 700 : 500,
                border: '1px solid',
                borderColor: status === value ? '#0052CC' : '#DFE1E6',
                borderRadius: 8,
                background: status === value ? '#DEEBFF' : 'white',
                color: status === value ? '#0052CC' : '#5E6C84',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="card overflow-x-auto p-5">
        <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 12, color: '#97A0AF' }}>Total</span>
            <div style={{ fontWeight: 700 }}>{totals.count}</div>
          </div>
          <div>
            <span style={{ fontSize: 12, color: '#97A0AF' }}>Faturado</span>
            <div style={{ fontWeight: 700, fontFamily: '"JetBrains Mono",monospace' }}>{formatEUR(totals.amount)}</div>
          </div>
          <div>
            <span style={{ fontSize: 12, color: '#97A0AF' }}>Cobrado</span>
            <div style={{ fontWeight: 700, fontFamily: '"JetBrains Mono",monospace', color: '#00875A' }}>
              {formatEUR(totals.paid)}
            </div>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : !invoices.length ? (
          <Empty message="Sem faturas para este filtro." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #EBECF0' }}>
                <th className="data-th">Fatura</th>
                <th className="data-th">Doente</th>
                <th className="data-th">Data</th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Valor
                </th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Pago
                </th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Saldo
                </th>
                <th className="data-th">Estado</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid #EBECF0' }}>
                  <td className="data-td" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
                    <Link
                      href={`/dashboard/admin/invoices/${inv.id}`}
                      style={{ color: '#0052CC', fontWeight: 600, textDecoration: 'none' }}
                    >
                      #{inv.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="data-td" style={{ fontWeight: 600 }}>
                    {inv.patient_name}
                  </td>
                  <td className="data-td" style={{ color: '#5E6C84' }}>
                    {inv.invoice_date ? formatDatePT(inv.invoice_date) : '—'}
                  </td>
                  <td
                    className="data-td"
                    style={{ textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
                  >
                    {formatEUR(Number(inv.amount))}
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
                    {formatEUR(Number(inv.paid))}
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
                    {formatEUR(Math.max(0, Number(inv.amount) - Number(inv.paid)))}
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
    </div>
  );
}
