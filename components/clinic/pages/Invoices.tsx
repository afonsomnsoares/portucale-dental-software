'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
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
  const [status, setStatus] = useState('');

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const qs = params.toString();
  const invoicesQuery = useQuery<Invoice[]>(`/invoices${qs ? `?${qs}` : ''}`);
  const invoices = invoicesQuery.data ?? [];

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
                fontSize: 'var(--text-xs)',
                fontWeight: status === value ? 700 : 500,
                border: '1px solid',
                borderColor: status === value ? 'var(--accent)' : 'var(--border-subtle)',
                borderRadius: 'var(--radius-control)',
                background: status === value ? 'var(--accent-bg)' : 'white',
                color: status === value ? 'var(--accent)' : 'var(--text-secondary)',
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
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Total</span>
            <div style={{ fontWeight: 'var(--weight-bold)' }}>{totals.count}</div>
          </div>
          <div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Faturado</span>
            <div style={{ fontWeight: 'var(--weight-bold)', fontFamily: '"JetBrains Mono",monospace' }}>
              {formatEUR(totals.amount)}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Cobrado</span>
            <div
              style={{
                fontWeight: 'var(--weight-bold)',
                fontFamily: '"JetBrains Mono",monospace',
                color: 'var(--urgency-ok)',
              }}
            >
              {formatEUR(totals.paid)}
            </div>
          </div>
        </div>

        {invoicesQuery.error ? (
          <ErrorState
            error={invoicesQuery.error}
            onRetry={invoicesQuery.refetch}
            message="Não foi possível ler as faturas."
          />
        ) : invoicesQuery.loading ? (
          <Spinner />
        ) : !invoices.length ? (
          <Empty message="Sem faturas para este filtro." />
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--bg-sunken)' }}>
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
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--bg-sunken)' }}>
                    <td
                      className="data-td"
                      style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 'var(--text-xs)' }}
                    >
                      <Link
                        href={`/dashboard/admin/invoices/${inv.id}`}
                        style={{ color: 'var(--accent)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}
                      >
                        #{inv.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                      {inv.patient_name}
                    </td>
                    <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                      {inv.invoice_date ? formatDatePT(inv.invoice_date) : '—'}
                    </td>
                    <td
                      className="data-td"
                      style={{
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {formatEUR(Number(inv.amount))}
                    </td>
                    <td
                      className="data-td"
                      style={{
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 'var(--text-xs)',
                        color: Number(inv.paid) > 0 ? 'var(--urgency-ok)' : 'var(--text-muted)',
                      }}
                    >
                      {formatEUR(Number(inv.paid))}
                    </td>
                    <td
                      className="data-td"
                      style={{
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 'var(--text-xs)',
                        color: Number(inv.amount) > Number(inv.paid) ? 'var(--urgency-critical)' : 'var(--urgency-ok)',
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
          </div>
        )}
      </div>
    </div>
  );
}
