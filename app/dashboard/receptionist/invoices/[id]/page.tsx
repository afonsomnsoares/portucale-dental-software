'use client';
import { ArrowLeft, Check } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
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
import type { Invoice } from '@/lib/types';

const PAY_METHODS = [
  { label: 'Cash', value: 'cash' },
  { label: 'Card', value: 'card' },
  { label: 'Insurance', value: 'insurance' },
  { label: 'Bank Transfer', value: 'bank transfer' },
  { label: 'Other', value: 'other' },
];

export default function InvoiceDetailPage() {
  const { api } = useAuth();
  const params = useParams();
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const id = params?.id;
    if (!id) return;
    const res = await api(`/invoices/${id}`).catch(() => null);
    setInv(res);
    setLoading(false);
  }, [api, params?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePay() {
    if (!inv) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      setErr('Enter a valid payment amount');
      return;
    }
    setErr('');
    setSuccess('');
    setSaving(true);
    const res = await api(`/invoices/${inv.id}/pay`, {
      method: 'PUT',
      body: { amount: amt, method: payMethod },
    }).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Payment failed');
      return null;
    });
    setSaving(false);
    if (res) {
      setInv(res);
      setPayModal(false);
      setPayAmount('');
      setPayMethod('cash');
      setSuccess(`Payment of $${amt.toLocaleString()} recorded successfully`);
      setTimeout(() => setSuccess(''), 4000);
    }
  }

  function fmtId(id: string) {
    return id ? `#${id.slice(0, 8).toUpperCase()}` : '';
  }
  function fmtDate(d: string | null | undefined) {
    if (!d) return '—';
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const items = inv?.items || [];
  const balance = inv ? Math.max(0, Number(inv.amount) - Number(inv.paid)) : 0;

  if (loading) return <Spinner />;
  if (!inv) {
    return (
      <div className="card p-5" style={{ color: 'var(--text-secondary)' }}>
        <GhostBtn onClick={() => router.back()} style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} style={{ marginRight: 6 }} /> Back
        </GhostBtn>
        Invoice not found.
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`Invoice ${fmtId(inv.id)}`} sub={`${inv.patient_name} · ${fmtDate(inv.invoice_date)}`}>
        <GhostBtn onClick={() => router.back()} style={{ padding: '8px 12px' }}>
          <ArrowLeft size={16} style={{ marginRight: 6 }} /> Back
        </GhostBtn>
        {balance > 0 && (
          <PrimaryBtn onClick={() => setPayModal(true)} style={{ padding: '8px 14px' }}>
            <Check size={16} style={{ marginRight: 6 }} /> Record Payment
          </PrimaryBtn>
        )}
      </PageHeader>

      {success && <AlertBanner type="success">{success}</AlertBanner>}
      {err && <AlertBanner type="danger">{err}</AlertBanner>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">Invoice Details</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <Row label="Status" value={<Badge s={inv.status} />} />
            <Row label="Amount" value={`$${Number(inv.amount).toLocaleString()}`} bold />
            <Row label="Paid" value={`$${Number(inv.paid).toLocaleString()}`} color="var(--urgency-ok)" />
            <Row
              label="Balance"
              value={`$${balance.toLocaleString()}`}
              color={balance > 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
              bold
            />
            <Row label="Method" value={inv.method || '—'} />
            <Row label="Invoice Date" value={fmtDate(inv.invoice_date)} />
            <Row label="Due Date" value={fmtDate(inv.due_date)} />
            <Row label="Dentist" value={inv.dentist_name || '—'} />
          </div>
        </div>

        <div className="card p-5">
          <div className="section-label mb-4">Patient</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            {inv.patient_name || '—'}
          </div>
          {inv.notes && (
            <>
              <div className="section-label mt-4 mb-2">Notes</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{inv.notes}</div>
            </>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card mt-4 p-5">
          <div className="section-label mb-3">Line Items</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--bg-sunken)' }}>
                <th className="data-th">Description</th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Amount
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
        <Modal title="Record Payment" onClose={() => setPayModal(false)} width={400}>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Invoice Total</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
              ${Number(inv.amount).toLocaleString()}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Already Paid</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--urgency-ok)' }}>
              ${Number(inv.paid).toLocaleString()}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="section-label mb-1">Remaining Balance</div>
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

          <FormField label="Payment Amount *">
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
          <FormField label="Payment Method">
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
              {saving ? 'Processing…' : `Pay $${Number(payAmount || 0).toLocaleString()}`}
            </PrimaryBtn>
            <GhostBtn onClick={() => setPayModal(false)}>Cancel</GhostBtn>
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
