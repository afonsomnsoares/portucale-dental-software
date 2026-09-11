'use client';
import { ArrowLeft, Check } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Invoice } from '@/lib/types';

const PAY_METHODS = [
  { label: 'Numerário', value: 'cash' },
  { label: 'Cartão', value: 'card' },
  { label: 'Seguro', value: 'insurance' },
  { label: 'Transferência bancária', value: 'bank transfer' },
  { label: 'Outro', value: 'other' },
];

export default function InvoiceDetailPage() {
  const { api } = useAuth();
  const params = useParams();
  const router = useRouter();

  const [payModal, setPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const id = params?.id;
  const invQuery = useQuery<Invoice>(id ? `/invoices/${id}` : null);
  const inv = invQuery.data ?? null;
  const load = invQuery.refetch;

  async function handlePay() {
    if (!inv) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      setErr('Introduza um valor de pagamento válido');
      return;
    }
    setErr('');
    setSuccess('');
    setSaving(true);
    const res = await api(`/invoices/${inv.id}/pay`, {
      method: 'PUT',
      body: { amount: amt, method: payMethod },
    }).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Pagamento falhou');
      return null;
    });
    setSaving(false);
    if (res) {
      // Revalida em vez de aceitar o corpo da resposta como a fatura completa:
      // registar um pagamento muda o saldo e o estado, e a linha que conta é a
      // que ficou na base de dados.
      load();
      setPayModal(false);
      setPayAmount('');
      setPayMethod('cash');
      setSuccess(`Pagamento de ${amt.toLocaleString()} registado com sucesso`);
      setTimeout(() => setSuccess(''), 4000);
    }
  }

  function fmtId(id: string) {
    return id ? `#${id.slice(0, 8).toUpperCase()}` : '';
  }
  function fmtDate(d: string | null | undefined) {
    if (!d) return '—';
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString('pt-PT', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const items = inv?.items || [];
  const balance = inv ? Math.max(0, Number(inv.amount) - Number(inv.paid)) : 0;

  if (invQuery.loading) return <Spinner />;
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

  return (
    <div>
      <PageHeader title={`Fatura ${fmtId(inv.id)}`} sub={`${inv.patient_name} · ${fmtDate(inv.invoice_date)}`}>
        <GhostBtn onClick={() => router.back()} style={{ padding: '8px 12px' }}>
          <ArrowLeft size={16} style={{ marginRight: 6 }} /> Voltar
        </GhostBtn>
        {balance > 0 && (
          <PrimaryBtn onClick={() => setPayModal(true)} style={{ padding: '8px 14px' }}>
            <Check size={16} style={{ marginRight: 6 }} /> Registar pagamento
          </PrimaryBtn>
        )}
      </PageHeader>

      {success && <AlertBanner type="success">{success}</AlertBanner>}
      {err && <AlertBanner type="danger">{err}</AlertBanner>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">Detalhes da fatura</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <Row label="Estado" value={<Badge s={inv.status} />} />
            <Row label="Valor" value={`$${Number(inv.amount).toLocaleString()}`} bold />
            <Row label="Pago" value={`$${Number(inv.paid).toLocaleString()}`} color="var(--urgency-ok)" />
            <Row
              label="Saldo"
              value={`$${balance.toLocaleString()}`}
              color={balance > 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
              bold
            />
            <Row label="Forma" value={inv.method || '—'} />
            <Row label="Data da fatura" value={fmtDate(inv.invoice_date)} />
            <Row label="Data de vencimento" value={fmtDate(inv.due_date)} />
            <Row label="Dentista" value={inv.dentist_name || '—'} />
          </div>
        </div>

        <div className="card p-5">
          <div className="section-label mb-4">Doente</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            {inv.patient_name || '—'}
          </div>
          {inv.notes && (
            <>
              <div className="section-label mt-4 mb-2">Notas</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{inv.notes}</div>
            </>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card mt-4 p-5">
          <div className="section-label mb-3">Linhas</div>
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
                // biome-ignore lint/suspicious/noArrayIndexKey: invoice line items have no id and this list is static (never reordered)
                <tr key={i} style={{ borderBottom: '1px solid var(--bg-sunken)' }}>
                  <td className="data-td">{item.description || '—'}</td>
                  <td
                    className="data-td"
                    style={{ textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
                  >
                    ${Number(item.amount || 0).toLocaleString()}
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
                  ${Number(inv.amount).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {payModal && (
        <Modal title="Registar pagamento" onClose={() => setPayModal(false)} width={400}>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Total da fatura</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
              ${Number(inv.amount).toLocaleString()}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Já pago</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--urgency-ok)' }}>
              ${Number(inv.paid).toLocaleString()}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Saldo remanescente</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: balance > 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)',
              }}
            >
              ${balance.toLocaleString()}
            </div>
          </div>

          <FormField label="Valor pago *">
            <Inp
              type="number"
              step="0.01"
              min="0"
              max={balance}
              value={payAmount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)}
              placeholder={`Max: $${balance.toLocaleString()}`}
            />
          </FormField>
          <FormField label="Forma de pagamento">
            <Sel value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {PAY_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Sel>
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={handlePay} disabled={saving || !payAmount || Number(payAmount) <= 0}>
              {saving ? 'A processar…' : `Pagar $${Number(payAmount || 0).toLocaleString()}`}
            </PrimaryBtn>
            <GhostBtn onClick={() => setPayModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
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
