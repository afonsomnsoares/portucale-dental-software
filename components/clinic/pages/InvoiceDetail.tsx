'use client';
import { ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge, ErrorState, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatDatePT, formatEUR } from '@/lib/constants';
import type { Invoice } from '@/lib/types';

// Detalhe de fatura para o admin da clínica — em euros e em português, ao contrário da
// versão de plataforma (components/super-admin/pages/InvoiceDetail.tsx), que continua em
// dólares/en-US. app/api/invoices/[id] já recusa faturas de outro tenant, por isso não há
// aqui nenhuma verificação de âmbito a fazer.
export default function ClinicInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  // `null` enquanto não houver id no URL: o hook fica em espera em vez de pedir
  // /invoices/undefined, que era o que a versão anterior evitava com um `return`
  // a meio do callback — e que deixava o `loading` preso a true para sempre.
  const id = params?.id;
  const invQuery = useQuery<Invoice>(id ? `/invoices/${id}` : null);
  const inv = invQuery.data ?? null;

  if (invQuery.loading) return <Spinner />;
  if (invQuery.error) return <ErrorState error={invQuery.error} onRetry={invQuery.refetch} />;
  if (invQuery.error)
    return <ErrorState error={invQuery.error} onRetry={invQuery.refetch} message="Não foi possível ler a fatura." />;
  if (!inv) {
    return (
      <div className="card p-5" style={{ color: 'var(--text-secondary)' }}>
        <GhostBtn onClick={() => router.back()} style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} style={{ marginRight: 6 }} /> Voltar
        </GhostBtn>
        Fatura não encontrada.
      </div>
    );
  }

  const items = inv.items || [];
  const balance = Math.max(0, Number(inv.amount) - Number(inv.paid));
  const fmtId = (id: string) => (id ? `#${id.slice(0, 8).toUpperCase()}` : '');
  const fmtDate = (d: string | null | undefined) => (d ? formatDatePT(d) : '—');

  return (
    <div>
      <PageHeader title={`Fatura ${fmtId(inv.id)}`} sub={`${inv.patient_name} · ${fmtDate(inv.invoice_date)}`}>
        <GhostBtn onClick={() => router.back()} style={{ padding: '8px 12px' }}>
          <ArrowLeft size={16} style={{ marginRight: 6 }} /> Voltar
        </GhostBtn>
      </PageHeader>

      <div className="grid-pair" style={{ gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">DADOS DA FATURA</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <Row label="Estado" value={<Badge s={inv.status} />} />
            <Row label="Valor" value={formatEUR(Number(inv.amount))} bold />
            <Row label="Pago" value={formatEUR(Number(inv.paid))} color="var(--urgency-ok)" />
            <Row
              label="Saldo"
              value={formatEUR(balance)}
              color={balance > 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
              bold
            />
            <Row label="Método" value={inv.method || '—'} />
            <Row label="Data de emissão" value={fmtDate(inv.invoice_date)} />
            <Row label="Data de vencimento" value={fmtDate(inv.due_date)} />
            <Row label="Médico dentista" value={inv.dentist_name || '—'} />
          </div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4">DOENTE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            {inv.patient_name || '—'}
          </div>
          {inv.notes && (
            <>
              <div className="section-label mt-4 mb-2">NOTAS</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{inv.notes}</div>
            </>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card mt-4 p-5">
          <div className="section-label mb-3">LINHAS</div>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--bg-sunken)' }}>
                  <th className="data-th">Descrição</th>
                  <th className="data-th" style={{ textAlign: 'right' }}>
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as linhas da fatura não têm id e a lista é estática (nunca reordenada)
                  <tr key={i} style={{ borderBottom: '1px solid var(--bg-sunken)' }}>
                    <td className="data-td">{item.description || '—'}</td>
                    <td
                      className="data-td"
                      style={{ textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
                    >
                      {formatEUR(Number(item.amount || 0))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="data-td" style={{ fontWeight: 700 }}>
                    Total
                  </td>
                  <td
                    className="data-td"
                    style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      fontFamily: '"JetBrains Mono",monospace',
                      fontSize: 12,
                    }}
                  >
                    {formatEUR(Number(inv.amount))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color, bold }: { label: string; value: ReactNode; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
