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
  Textarea,
} from '@/components/ui';
import type { Patient, Prescription } from '@/lib/types';

interface NewPrescriptionForm {
  medication: string;
  dosage: string;
  frequency: string;
  route: string;
  duration: string;
  quantity: string;
  refills: number | string;
  instructions: string;
}

export default function PrescriptionsPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewPrescriptionForm>({
    medication: '',
    dosage: '',
    frequency: '',
    route: 'oral',
    duration: '',
    quantity: '',
    refills: 0,
    instructions: '',
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
      api(`/prescriptions?patientId=${selected.id}`)
        .then(setPrescriptions)
        .catch(() => setPrescriptions([]));
    }
  }, [selected, api]);

  async function create() {
    if (!form.medication || !form.dosage || !form.frequency || !selected) return;
    setSaving(true);
    const p = await api('/prescriptions', {
      method: 'POST',
      body: { patientId: selected.id, ...form, refills: Number(form.refills) },
    }).catch(() => null);
    if (p) {
      setPrescriptions((prev) => [p, ...prev]);
      setModal(false);
      setForm({
        medication: '',
        dosage: '',
        frequency: '',
        route: 'oral',
        duration: '',
        quantity: '',
        refills: 0,
        instructions: '',
      });
    }
    setSaving(false);
  }

  async function cancel(id: string) {
    const u = await api(`/prescriptions/${id}`, { method: 'PUT', body: { status: 'cancelled' } }).catch(() => null);
    if (u) setPrescriptions((prev) => prev.map((p) => (p.id === id ? u : p)));
  }

  const cols = ['Medication', 'Dosage', 'Frequency', 'Status', 'Date', 'Actions'];

  return (
    <div>
      <PageHeader title="Prescriptions" sub="Patient prescriptions — create and manage" />
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
              <PrimaryBtn onClick={() => setModal(true)}>+ New Prescription</PrimaryBtn>
            </div>
            {!prescriptions.length ? (
              <Empty message="No prescriptions" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={prescriptions.map((p) => (
                    <tr key={p.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {p.medication}
                      </td>
                      <td className="data-td">{p.dosage}</td>
                      <td className="data-td">{p.frequency}</td>
                      <td className="data-td">
                        <Badge s={p.status} />
                      </td>
                      <td className="data-td">{p.created_at?.slice(0, 10)}</td>
                      <td className="data-td">
                        {p.status !== 'cancelled' && (
                          <DangerBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => cancel(p.id)}>
                            Cancel
                          </DangerBtn>
                        )}
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view prescriptions" />
        )}
      </div>

      {modal && (
        <Modal title="New Prescription" onClose={() => setModal(false)} width={540}>
          <FormField label="Medication *">
            <Inp
              value={form.medication}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, medication: e.target.value }))}
              placeholder="Medication name"
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Dosage *">
              <Inp
                value={form.dosage}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, dosage: e.target.value }))}
                placeholder="e.g. 500mg"
              />
            </FormField>
            <FormField label="Frequency *">
              <Inp
                value={form.frequency}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                placeholder="e.g. BID"
              />
            </FormField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Route">
              <Sel value={form.route} onChange={(e) => setForm((p) => ({ ...p, route: e.target.value }))}>
                <option value="oral">Oral</option>
                <option value="topical">Topical</option>
                <option value="IV">IV</option>
                <option value="IM">IM</option>
              </Sel>
            </FormField>
            <FormField label="Duration">
              <Inp
                value={form.duration}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, duration: e.target.value }))}
                placeholder="e.g. 7 days"
              />
            </FormField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Quantity">
              <Inp
                type="number"
                value={form.quantity}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              />
            </FormField>
            <FormField label="Refills">
              <Inp
                type="number"
                min={0}
                value={form.refills}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, refills: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Instructions">
            <Textarea
              value={form.instructions}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, instructions: e.target.value }))
              }
              placeholder="Usage instructions…"
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.medication || !form.dosage || !form.frequency}>
              {saving ? 'Creating…' : 'Create Prescription'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
