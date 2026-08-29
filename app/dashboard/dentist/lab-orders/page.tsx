'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  Textarea,
} from '@/components/ui';
import type { LabOrder, Patient } from '@/lib/types';

const CASE_TYPES = ['crown', 'bridge', 'denture', 'implant', 'veneer', 'ortho', 'other'];

const STATUS_FLOW = ['ordered', 'sent', 'in-progress', 'received'];
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ordered: { bg: '#FFEBE6', color: '#DE350B' },
  sent: { bg: '#DEEBFF', color: '#0052CC' },
  'in-progress': { bg: '#EAE6FF', color: '#5243AA' },
  received: { bg: '#E3FCEF', color: '#00875A' },
};

interface NewLabOrderForm {
  labName: string;
  caseType: string;
  toothNums: string;
  description: string;
  instructions: string;
  dueDate: string;
  fee: string;
}

export default function LabOrdersPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewLabOrderForm>({
    labName: '',
    caseType: 'crown',
    toothNums: '',
    description: '',
    instructions: '',
    dueDate: '',
    fee: '',
  });

  const select = useCallback((p: Patient) => {
    setSelected(p);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const pts = await api('/patients').catch(() => []);
    setPatients(pts || []);
    if (!selected && pts?.length) select(pts[0]);
    setLoading(false);
  }, [api, selected, select]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (selected) {
      api(`/lab-orders?patientId=${selected.id}`)
        .then(setOrders)
        .catch(() => setOrders([]));
    }
  }, [selected, api]);

  async function create() {
    if (!form.labName || !form.description || !selected) return;
    setSaving(true);
    const o = await api('/lab-orders', {
      method: 'POST',
      body: { patientId: selected.id, ...form, fee: Number(form.fee) || 0 },
    }).catch(() => null);
    if (o) {
      setOrders((prev) => [o, ...prev]);
      setModal(false);
      setForm({
        labName: '',
        caseType: 'crown',
        toothNums: '',
        description: '',
        instructions: '',
        dueDate: '',
        fee: '',
      });
    }
    setSaving(false);
  }

  async function advanceStatus(order: LabOrder) {
    const idx = STATUS_FLOW.indexOf(order.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    const u = await api(`/lab-orders/${order.id}`, { method: 'PUT', body: { status: next } }).catch(() => null);
    if (u) setOrders((prev) => prev.map((o) => (o.id === order.id ? u : o)));
  }

  function renderStatusBadge(s: string) {
    const cfg = STATUS_COLORS[s] || { bg: '#F4F7FA', color: '#5E6C84' };
    return <Badge label={s} bg={cfg.bg} color={cfg.color} />;
  }

  const cols = ['Lab', 'Case Type', 'Tooth #', 'Status', 'Due Date', 'Fee', 'Actions'];

  return (
    <div>
      <PageHeader title="Lab Orders" sub="Dental laboratory orders — track status across the workflow" />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #EBECF0' }}>
            <input
              className="input"
              placeholder="Search name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
            {loading ? (
              <Spinner />
            ) : !patients.length ? (
              <Empty message="No patients" />
            ) : (
              patients.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => select(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(p);
                    }
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    border: 'none',
                    font: 'inherit',
                    textAlign: 'left',
                    padding: '11px 16px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #F4F7FA',
                    background: selected?.id === p.id ? '#DEEBFF' : 'white',
                    borderLeft: `3px solid ${selected?.id === p.id ? '#0052CC' : 'transparent'}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#97A0AF' }}>
                    #{p.global_seq} · <Badge s={p.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selected ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <PrimaryBtn onClick={() => setModal(true)}>+ New Lab Order</PrimaryBtn>
            </div>
            {!orders.length ? (
              <Empty message="No lab orders" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={orders.map((o) => (
                    <tr key={o.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {o.lab_name}
                      </td>
                      <td className="data-td">{o.case_type}</td>
                      <td className="data-td">{o.tooth_nums || '—'}</td>
                      <td className="data-td">{renderStatusBadge(o.status)}</td>
                      <td className="data-td">{o.due_date ? o.due_date.slice(0, 10) : '—'}</td>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        ${Number(o.fee || 0).toLocaleString()}
                      </td>
                      <td className="data-td">
                        {o.status !== 'received' && (
                          <GhostBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => advanceStatus(o)}>
                            {o.status === 'ordered' ? 'Send' : o.status === 'sent' ? 'In Progress' : 'Receive'}
                          </GhostBtn>
                        )}
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view lab orders" />
        )}
      </div>

      {modal && (
        <Modal title="New Lab Order" onClose={() => setModal(false)} width={540}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Lab Name *">
              <Inp
                value={form.labName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, labName: e.target.value }))}
                placeholder="Lab name"
              />
            </FormField>
            <FormField label="Case Type">
              <Sel value={form.caseType} onChange={(e) => setForm((p) => ({ ...p, caseType: e.target.value }))}>
                {CASE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Sel>
            </FormField>
          </div>
          <FormField label="Tooth Numbers">
            <Inp
              value={form.toothNums}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, toothNums: e.target.value }))}
              placeholder="e.g. 14,15,18"
            />
          </FormField>
          <FormField label="Description *">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Case description…"
            />
          </FormField>
          <FormField label="Instructions">
            <Textarea
              value={form.instructions}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, instructions: e.target.value }))
              }
              placeholder="Lab instructions…"
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Due Date">
              <Inp
                type="date"
                value={form.dueDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </FormField>
            <FormField label="Fee ($)">
              <Inp
                type="number"
                value={form.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.labName || !form.description}>
              {saving ? 'Creating…' : 'Create Lab Order'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
