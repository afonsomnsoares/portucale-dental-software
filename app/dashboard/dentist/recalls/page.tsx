'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DangerBtn,
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
} from '@/components/ui';
import type { Patient, Recall } from '@/lib/types';

const RECALL_TYPES = ['checkup', 'prophylaxis', 'follow-up', 'other'];

interface NewRecallForm {
  recallType: string;
  intervalMonths: number | string;
  nextDue: string;
}

export default function RecallsPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewRecallForm>({ recallType: 'checkup', intervalMonths: 6, nextDue: '' });

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
      api(`/recalls?patientId=${selected.id}`)
        .then(setRecalls)
        .catch(() => setRecalls([]));
    }
  }, [selected, api]);

  async function create() {
    if (!form.nextDue || !selected) return;
    setSaving(true);
    const r = await api('/recalls', {
      method: 'POST',
      body: { patientId: selected.id, ...form, intervalMonths: Number(form.intervalMonths) },
    }).catch(() => null);
    if (r) {
      setRecalls((prev) => [r, ...prev]);
      setModal(false);
      setForm({ recallType: 'checkup', intervalMonths: 6, nextDue: '' });
    }
    setSaving(false);
  }

  async function complete(id: string) {
    const u = await api(`/recalls/${id}`, { method: 'PUT', body: { complete: true } }).catch(() => null);
    if (u) setRecalls((prev) => prev.map((r) => (r.id === id ? u : r)));
  }

  async function deactivate(id: string) {
    const u = await api(`/recalls/${id}`, { method: 'PUT', body: { active: false } }).catch(() => null);
    if (u) setRecalls((prev) => prev.map((r) => (r.id === id ? u : r)));
  }

  function recallStatus(r: Recall) {
    if (!r.active) return { label: 'Inactive', bg: '#F4F7FA', color: '#97A0AF' };
    const due = r.next_due ? new Date(r.next_due) : null;
    if (due && due < new Date()) return { label: 'Overdue', bg: '#FFEBE6', color: '#DE350B' };
    return { label: 'Active', bg: '#DEEBFF', color: '#0052CC' };
  }

  const cols = ['Type', 'Interval', 'Last Done', 'Next Due', 'Status', 'Actions'];

  return (
    <div>
      <PageHeader title="Recalls" sub="Patient recall schedule — automated follow-up reminders" />
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
              <PrimaryBtn onClick={() => setModal(true)}>+ Add Recall</PrimaryBtn>
            </div>
            {!recalls.length ? (
              <Empty message="No recall schedule" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={recalls.map((r) => {
                    const s = recallStatus(r);
                    return (
                      <tr key={r.id}>
                        <td className="data-td" style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                          {r.recall_type}
                        </td>
                        <td className="data-td">{r.interval_months} months</td>
                        <td className="data-td">{r.last_done ? r.last_done.slice(0, 10) : '—'}</td>
                        <td className="data-td">{r.next_due ? r.next_due.slice(0, 10) : '—'}</td>
                        <td className="data-td">
                          <Badge label={s.label} bg={s.bg} color={s.color} />
                        </td>
                        <td className="data-td">
                          {r.active && (
                            <>
                              <GhostBtn
                                style={{ padding: '4px 12px', fontSize: 11, marginRight: 4 }}
                                onClick={() => complete(r.id)}
                              >
                                Complete
                              </GhostBtn>
                              <DangerBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => deactivate(r.id)}>
                                Deactivate
                              </DangerBtn>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view recalls" />
        )}
      </div>

      {modal && (
        <Modal title="Add Recall" onClose={() => setModal(false)} width={460}>
          <FormField label="Recall Type">
            <Sel value={form.recallType} onChange={(e) => setForm((p) => ({ ...p, recallType: e.target.value }))}>
              {RECALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Interval (months)">
            <Inp
              type="number"
              min={1}
              max={60}
              value={form.intervalMonths}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm((p) => ({ ...p, intervalMonths: e.target.value }))
              }
            />
          </FormField>
          <FormField label="Next Due Date *">
            <Inp
              type="date"
              value={form.nextDue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.nextDue}>
              {saving ? 'Creating…' : 'Add Recall'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
