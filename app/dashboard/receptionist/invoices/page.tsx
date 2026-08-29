'use client';
import Link from 'next/link';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
} from '@/components/ui';
import type { Invoice, Patient } from '@/lib/types';

interface Dentist {
  id: string;
  name: string;
}

interface NewInvoiceForm {
  patientId: string;
  dentistId: string;
  amount: string;
  invoiceDate: string;
  dueDate: string;
  method: string;
  notes: string;
  items: string;
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Partial', value: 'partial' },
  { label: 'Paid', value: 'paid' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function InvoicesPage() {
  const { api } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<NewInvoiceForm>({
    patientId: '',
    dentistId: '',
    amount: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    method: 'cash',
    notes: '',
    items: '',
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const [inv, pat, den] = await Promise.all([
      api(`/invoices?${params.toString()}`).catch(() => []),
      api('/patients').catch(() => []),
      api('/dentists').catch(() => []),
    ]);
    setInvoices(inv || []);
    setPatients(pat || []);
    setDentists(den || []);
    setLoading(false);
  }, [api, status]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    return invoices.reduce(
      (acc, inv) => ({
        count: acc.count + 1,
        amount: acc.amount + Number(inv.amount),
        paid: acc.paid + Number(inv.paid),
      }),
      { count: 0, amount: 0, paid: 0 },
    );
  }, [invoices]);

  async function handleCreate() {
    setErr('');
    if (!form.patientId || !form.amount) {
      setErr('Patient and amount are required');
      return;
    }
    setSaving(true);
    const items = form.items
      ? form.items
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(' - ');
            return { description: parts[0] || line, amount: Number(parts[1]) || 0 };
          })
      : [];
    const body = {
      patientId: form.patientId,
      dentistId: form.dentistId || undefined,
      amount: Number(form.amount),
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate || undefined,
      method: form.method,
      notes: form.notes,
      items: items.length ? items : undefined,
    };
    const res = await api('/invoices', { method: 'POST', body }).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Failed to create invoice');
      return null;
    });
    setSaving(false);
    if (res) {
      setModal(false);
      setForm({
        patientId: '',
        dentistId: '',
        amount: '',
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: '',
        method: 'cash',
        notes: '',
        items: '',
      });
      load();
    }
  }

  function invTotal(inv: Invoice) {
    return `$${Number(inv.amount).toLocaleString()}`;
  }
  function invPaid(inv: Invoice) {
    return `$${Number(inv.paid).toLocaleString()}`;
  }
  function invBal(inv: Invoice) {
    return `$${Math.max(0, Number(inv.amount) - Number(inv.paid)).toLocaleString()}`;
  }
  function fmtId(id: string) {
    return id ? `#${id.slice(0, 8).toUpperCase()}` : '';
  }
  function fmtDate(d: string | null | undefined) {
    if (!d) return '—';
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Invoices"
        sub={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} · $${totals.amount.toLocaleString()} total · $${totals.paid.toLocaleString()} collected`}
      >
        <div className="flex gap-2 items-center">
          {STATUS_FILTERS.map((s) => (
            <button
              type="button"
              key={s.value}
              onClick={() => setStatus(s.value)}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: status === s.value ? 700 : 500,
                border: '1px solid',
                borderColor: status === s.value ? '#0052CC' : '#DFE1E6',
                borderRadius: 8,
                background: status === s.value ? '#DEEBFF' : 'white',
                color: status === s.value ? '#0052CC' : '#5E6C84',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <GhostBtn onClick={() => setModal(true)} style={{ padding: '8px 14px' }}>
          + New Invoice
        </GhostBtn>
      </PageHeader>

      {err && <AlertBanner type="danger">{err}</AlertBanner>}

      {!invoices.length ? (
        <div className="card p-5">
          <Empty message={status ? `No ${status} invoices found` : 'No invoices yet'} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #EBECF0' }}>
                <th className="data-th">Invoice</th>
                <th className="data-th">Patient</th>
                <th className="data-th">Date</th>
                <th className="data-th">Dentist</th>
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
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Method
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  style={{ borderBottom: '1px solid #EBECF0', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F8F9FC')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="data-td">
                    <Link
                      href={`/dashboard/receptionist/invoices/${inv.id}`}
                      style={{
                        color: '#0052CC',
                        fontWeight: 600,
                        textDecoration: 'none',
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 12,
                      }}
                    >
                      {fmtId(inv.id)}
                    </Link>
                  </td>
                  <td className="data-td" style={{ fontWeight: 600 }}>
                    {inv.patient_name || '—'}
                  </td>
                  <td className="data-td" style={{ color: '#5E6C84' }}>
                    {fmtDate(inv.invoice_date)}
                  </td>
                  <td className="data-td" style={{ color: '#5E6C84' }}>
                    {inv.dentist_name || '—'}
                  </td>
                  <td
                    className="data-td"
                    style={{ textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
                  >
                    {invTotal(inv)}
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
                    {invPaid(inv)}
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
                    {invBal(inv)}
                  </td>
                  <td className="data-td">
                    <Badge s={inv.status} />
                  </td>
                  <td className="data-td" style={{ textAlign: 'right', color: '#5E6C84', fontSize: 12 }}>
                    {inv.method}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="New Invoice" onClose={() => setModal(false)} width={520}>
          <FormField label="Patient *">
            <Sel value={form.patientId} onChange={(e) => setForm((p) => ({ ...p, patientId: e.target.value }))}>
              <option value="">— Select patient —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Dentist">
            <Sel value={form.dentistId} onChange={(e) => setForm((p) => ({ ...p, dentistId: e.target.value }))}>
              <option value="">— Optional —</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Amount *">
            <Inp
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, amount: e.target.value }))}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Invoice Date">
              <Inp
                type="date"
                value={form.invoiceDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, invoiceDate: e.target.value }))}
              />
            </FormField>
            <FormField label="Due Date">
              <Inp
                type="date"
                value={form.dueDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Payment Method">
            <Sel value={form.method} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="insurance">Insurance</option>
              <option value="bank transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </Sel>
          </FormField>
          <FormField label="Line Items (one per line: Description - Amount)" hint="Optional — for invoice breakdown">
            <textarea
              className="input"
              value={form.items}
              onChange={(e) => setForm((p) => ({ ...p, items: e.target.value }))}
              style={{ resize: 'vertical', minHeight: 60, fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}
              placeholder="Crown #14 - 1800&#x0a;Scaling - 280"
            />
          </FormField>
          <FormField label="Notes">
            <Inp
              value={form.notes}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={handleCreate} disabled={saving || !form.patientId || !form.amount}>
              {saving ? 'Creating…' : 'Create Invoice'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
