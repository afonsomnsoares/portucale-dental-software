'use client';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  DangerBtn,
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
  patientId: string;
  recallType: string;
  intervalMonths: number | string;
  lastDone: string;
  nextDue: string;
  notes: string;
}

export default function ReceptionistRecallsPage() {
  const { api } = useAuth();
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [_search, _setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewRecallForm>({
    patientId: '',
    recallType: 'checkup',
    intervalMonths: 6,
    lastDone: '',
    nextDue: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [dueFilter, setDueFilter] = useState('30');

  const loadRecalls = useCallback(async () => {
    setLoading(true);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + Number(dueFilter));
    const r = await api(`/recalls?dueBefore=${dueDate.toISOString().slice(0, 10)}`).catch(() => []);
    setRecalls(r || []);
    setLoading(false);
  }, [api, dueFilter]);

  useEffect(() => {
    loadRecalls();
  }, [loadRecalls]);

  const loadPatients = useCallback(async () => {
    const d = await api('/patients?q=').catch(() => []);
    setPatients(d || []);
  }, [api]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  function patientName(id: string) {
    const p = patients.find((x) => x.id === id);
    return p ? p.name : id?.slice(0, 8) || '—';
  }

  function statusMeta(r: Recall) {
    if (!r.active) return { label: 'Inactive', bg: '#FFEBE6', color: '#DE350B' };
    if (r.next_due && r.next_due < new Date().toISOString().slice(0, 10))
      return { label: 'Overdue', bg: '#FFF7E6', color: '#FF8B00' };
    if (r.last_done) return { label: 'Active', bg: '#E3FCEF', color: '#00875A' };
    return { label: 'Active', bg: '#E3FCEF', color: '#00875A' };
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.patientId || !form.nextDue) return;
    setSaving(true);
    const body = {
      patientId: form.patientId,
      recallType: form.recallType,
      intervalMonths: Number(form.intervalMonths),
      lastDone: form.lastDone || null,
      nextDue: form.nextDue,
      notes: form.notes || null,
    };
    await api('/recalls', { method: 'POST', body }).catch(() => null);
    setSaving(false);
    setModal(false);
    setForm({ patientId: '', recallType: 'checkup', intervalMonths: 6, lastDone: '', nextDue: '', notes: '' });
    loadRecalls();
  }

  async function handleComplete(id: string) {
    await api(`/recalls/${id}`, { method: 'PUT', body: { complete: true } }).catch(() => null);
    loadRecalls();
  }

  async function handleDeactivate(id: string) {
    await api(`/recalls/${id}`, { method: 'PUT', body: { active: false } }).catch(() => null);
    loadRecalls();
  }

  return (
    <div>
      <PageHeader title="Patient Recalls" sub="Track and manage periodic exam and prophylaxis reminders">
        <PrimaryBtn onClick={() => setModal(true)}>+ New Recall</PrimaryBtn>
      </PageHeader>

      <div className="card p-4 mb-5 flex items-center gap-4">
        <span className="section-label">Due within</span>
        <Sel value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} style={{ width: 100 }}>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </Sel>
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
          {recalls.length} recall{recalls.length !== 1 ? 's' : ''} due
        </span>
      </div>

      {loading ? (
        <Spinner />
      ) : !recalls.length ? (
        <Empty message="No recalls due in this period." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="data-th">Patient</th>
                <th className="data-th">Type</th>
                <th className="data-th">Interval</th>
                <th className="data-th">Last Done</th>
                <th className="data-th">Next Due</th>
                <th className="data-th">Status</th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {recalls.map((r) => {
                const sm = statusMeta(r);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
                    <td className="data-td" style={{ fontWeight: 600 }}>
                      {patientName(r.patient_id)}
                    </td>
                    <td className="data-td" style={{ textTransform: 'capitalize' }}>
                      {r.recall_type}
                    </td>
                    <td className="data-td">{r.interval_months}mo</td>
                    <td className="data-td">{r.last_done?.slice(0, 10) || '—'}</td>
                    <td className="data-td" style={{ fontWeight: sm.label === 'Overdue' ? 700 : 400, color: sm.color }}>
                      {r.next_due?.slice(0, 10)}
                    </td>
                    <td className="data-td">
                      <span className="badge" style={{ background: sm.bg, color: sm.color }}>
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: sm.color,
                            display: 'inline-block',
                            marginRight: 5,
                          }}
                        />
                        {sm.label}
                      </span>
                    </td>
                    <td className="data-td" style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {r.active && <GhostBtn onClick={() => handleComplete(r.id)}>Complete</GhostBtn>}
                        {r.active && <DangerBtn onClick={() => handleDeactivate(r.id)}>Stop</DangerBtn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="New Recall Schedule" onClose={() => setModal(false)}>
          <form onSubmit={handleCreate}>
            <FormField label="Patient">
              <Sel
                value={form.patientId}
                onChange={(e) => setForm((p) => ({ ...p, patientId: e.target.value }))}
                required
              >
                <option value="">— Select —</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Sel>
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Recall Type">
                <Sel value={form.recallType} onChange={(e) => setForm((p) => ({ ...p, recallType: e.target.value }))}>
                  {RECALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                  required
                />
              </FormField>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Last Done">
                <Inp
                  type="date"
                  value={form.lastDone}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, lastDone: e.target.value }))}
                />
              </FormField>
              <FormField label="Next Due">
                <Inp
                  type="date"
                  value={form.nextDue}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
                  required
                />
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea
                className="input"
                style={{ resize: 'vertical', minHeight: 60, width: '100%' }}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </FormField>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
              <PrimaryBtn type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Create Recall'}
              </PrimaryBtn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
