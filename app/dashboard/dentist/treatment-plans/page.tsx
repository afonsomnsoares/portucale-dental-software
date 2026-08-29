'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Spinner,
  Textarea,
} from '@/components/ui';
import type { Patient, TreatmentPlan } from '@/lib/types';

interface PhaseForm {
  phase: number;
  description: string;
  fee: string;
}

interface PlanForm {
  title: string;
  description: string;
  phases: PhaseForm[];
}

export default function TreatmentPlansPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [modal, setModal] = useState(false);
  const [detailModal, setDetailModal] = useState<TreatmentPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PlanForm>({
    title: '',
    description: '',
    phases: [{ phase: 1, description: '', fee: '' }],
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
      api(`/treatment-plans?patientId=${selected.id}`)
        .then(setPlans)
        .catch(() => setPlans([]));
    }
  }, [selected, api]);

  const totalFee = form.phases.reduce((a, p) => a + (Number(p.fee) || 0), 0);

  function addPhase() {
    setForm((prev) => ({
      ...prev,
      phases: [...prev.phases, { phase: prev.phases.length + 1, description: '', fee: '' }],
    }));
  }

  function updatePhase(idx: number, field: keyof PhaseForm, value: string) {
    setForm((prev) => {
      const phases = [...prev.phases];
      phases[idx] = { ...phases[idx], [field]: value };
      return { ...prev, phases };
    });
  }

  function removePhase(idx: number) {
    setForm((prev) => {
      const phases = prev.phases.filter((_, i) => i !== idx).map((p, i) => ({ ...p, phase: i + 1 }));
      return { ...prev, phases };
    });
  }

  async function create() {
    if (!form.title || !selected) return;
    setSaving(true);
    const p = await api('/treatment-plans', {
      method: 'POST',
      body: { patientId: selected.id, ...form, totalFee },
    }).catch(() => null);
    if (p) {
      setPlans((prev) => [p, ...prev]);
      setModal(false);
      setForm({ title: '', description: '', phases: [{ phase: 1, description: '', fee: '' }] });
    }
    setSaving(false);
  }

  async function approve(id: string) {
    const u = await api(`/treatment-plans/${id}`, { method: 'PUT', body: { approve: true } }).catch(() => null);
    if (u) setPlans((prev) => prev.map((p) => (p.id === id ? u : p)));
  }

  const cols = ['Title', 'Total Fee', 'Status', 'Created', 'Actions'];

  return (
    <div>
      <PageHeader title="Treatment Plans" sub="Custom treatment plans with phased pricing" />
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
              <PrimaryBtn onClick={() => setModal(true)}>+ New Plan</PrimaryBtn>
            </div>
            {!plans.length ? (
              <Empty message="No treatment plans" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={plans.map((p) => (
                    <tr key={p.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {p.title}
                      </td>
                      <td className="data-td" style={{ fontWeight: 700 }}>
                        ${Number(p.total_fee || 0).toLocaleString()}
                      </td>
                      <td className="data-td">
                        <Badge s={p.status || 'draft'} />
                      </td>
                      <td className="data-td">{p.created_at?.slice(0, 10)}</td>
                      <td className="data-td">
                        <GhostBtn
                          style={{ padding: '4px 12px', fontSize: 11, marginRight: 6 }}
                          onClick={() => setDetailModal(p)}
                        >
                          View
                        </GhostBtn>
                        {p.status === 'draft' && (
                          <PrimaryBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => approve(p.id)}>
                            Approve
                          </PrimaryBtn>
                        )}
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view treatment plans" />
        )}
      </div>

      {modal && (
        <Modal title="New Treatment Plan" onClose={() => setModal(false)} width={560}>
          <FormField label="Title *">
            <Inp
              value={form.title}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Plan title"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Plan description…"
            />
          </FormField>
          <div className="section-label mb-2">Phases</div>
          {form.phases.map((ph, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: phases have no id; index matches updatePhase/removePhase's own indexing
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ width: 60, fontSize: 12, fontWeight: 600, color: '#5E6C84', paddingBottom: 10 }}>
                Phase {ph.phase}
              </div>
              <Inp
                placeholder="Description"
                value={ph.description}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updatePhase(i, 'description', e.target.value)}
                style={{ flex: 1 }}
              />
              <Inp
                type="number"
                placeholder="Fee"
                value={ph.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updatePhase(i, 'fee', e.target.value)}
                style={{ width: 100 }}
              />
              {form.phases.length > 1 && (
                <GhostBtn style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => removePhase(i)}>
                  ×
                </GhostBtn>
              )}
            </div>
          ))}
          <GhostBtn onClick={addPhase} style={{ fontSize: 12, marginBottom: 12 }}>
            + Add Phase
          </GhostBtn>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#172B4D', marginBottom: 16 }}>
            Total Fee: ${totalFee.toLocaleString()}
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.title}>
              {saving ? 'Creating…' : 'Create Plan'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}

      {detailModal && (
        <Modal title={detailModal.title} onClose={() => setDetailModal(null)} width={560}>
          {detailModal.description && (
            <p style={{ fontSize: 13, color: '#5E6C84', marginBottom: 16 }}>{detailModal.description}</p>
          )}
          <div className="section-label mb-2">Phases</div>
          {(detailModal.phases || []).map((ph, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: phases have no id and this list is static (read-only detail view)
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #F4F7FA',
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#97A0AF', marginRight: 8 }}>
                  PHASE {ph.phase}
                </span>
                <span style={{ fontSize: 13, color: '#172B4D' }}>{ph.description}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#172B4D' }}>
                ${Number(ph.fee || 0).toLocaleString()}
              </span>
            </div>
          ))}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '12px 0',
              fontSize: 15,
              fontWeight: 800,
              color: '#172B4D',
              borderTop: '2px solid #DFE1E6',
              marginTop: 8,
            }}
          >
            <span>Total</span>
            <span>${Number(detailModal.total_fee || 0).toLocaleString()}</span>
          </div>
          {detailModal.approved_by && (
            <AlertBanner type="success">
              Approved by {detailModal.approved_by} on{' '}
              {detailModal.approved_at ? new Date(detailModal.approved_at).toLocaleDateString() : '—'}
            </AlertBanner>
          )}
          <div className="flex gap-3 mt-2">
            <GhostBtn onClick={() => setDetailModal(null)}>Close</GhostBtn>
            {detailModal.status === 'draft' && (
              <PrimaryBtn
                onClick={async () => {
                  await approve(detailModal.id);
                  setDetailModal(null);
                }}
              >
                Approve
              </PrimaryBtn>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
