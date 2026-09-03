'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import TreatmentTable from '@/components/TreatmentTable';
import {
  Badge,
  FormField,
  GhostBtn,
  Inp,
  MetricCard,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
} from '@/components/ui';
import type { Patient, Treatment } from '@/lib/types';

interface NewTreatmentForm {
  patientId: string;
  treatmentCode: string;
  description: string;
  phase: string;
  fee: string;
  notes: string;
}

const PHASES = [
  { n: 1, label: 'Emergency', color: '#DE350B', bg: '#FFEBE6' },
  { n: 2, label: 'Restorative', color: '#0052CC', bg: '#DEEBFF' },
  { n: 3, label: 'Aesthetic', color: '#5243AA', bg: '#EAE6FF' },
];

export default function DentistTreatmentsPage() {
  const { api, settings } = useAuth();
  const TANOMD_CODES = settings?.TANOMD_CODES || [];
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selPat, setSelPat] = useState('all');
  const [viewMode, setViewMode] = useState('roadmap');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewTreatmentForm>({
    patientId: '',
    treatmentCode: '',
    description: '',
    phase: '1',
    fee: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [tr, pts] = await Promise.all([api('/treatments').catch(() => []), api('/patients').catch(() => [])]);
    setTreatments(tr || []);
    setPatients(pts || []);
    setLoading(false);
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!form.patientId || !form.description) return;
    setSaving(true);
    const t = await api('/treatments', {
      method: 'POST',
      body: {
        patientId: form.patientId,
        treatmentCode: form.treatmentCode || null,
        description: form.description,
        phase: Number(form.phase),
        fee: Number(form.fee) || 0,
        notes: form.notes,
      },
    }).catch(() => null);
    if (t) {
      setTreatments((prev) => [t, ...prev]);
      setModal(false);
      setForm({ patientId: '', treatmentCode: '', description: '', phase: '1', fee: '', notes: '' });
    }
    setSaving(false);
  }

  async function update(id: string, body: Record<string, unknown>) {
    const u = await api(`/treatments/${id}`, { method: 'PUT', body }).catch(() => null);
    if (u) setTreatments((prev) => prev.map((t) => (t.id === id ? u : t)));
  }
  async function del(id: string) {
    await api(`/treatments/${id}`, { method: 'DELETE' }).catch(() => null);
    setTreatments((prev) => prev.filter((t) => t.id !== id));
  }

  const visible = selPat === 'all' ? treatments : treatments.filter((t) => t.patient_id === selPat);
  const ptOptions = patients.filter((p) => treatments.some((t) => t.patient_id === p.id));

  return (
    <div>
      <PageHeader
        title="Treatments"
        sub="Clinical treatment management — all patients"
        action="+ New Treatment"
        onAction={() => setModal(true)}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {['roadmap', 'table'].map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                background: viewMode === m ? '#0052CC' : 'white',
                color: viewMode === m ? 'white' : '#5E6C84',
                boxShadow: viewMode !== m ? '0 1px 3px rgba(23,43,77,0.10),0 0 0 1px rgba(23,43,77,0.06)' : 'none',
              }}
            >
              {m === 'roadmap' ? 'Phase View' : 'Table View'}
            </button>
          ))}
        </div>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard
          label="TOTAL VALUE"
          value={`$${visible.reduce((a, t) => a + Number(t.fee), 0).toLocaleString()}`}
          color="#0052CC"
        />
        <MetricCard label="PROPOSED" value={visible.filter((t) => t.status === 'proposed').length} color="#FF8B00" />
        <MetricCard label="IN PROGRESS" value={visible.filter((t) => t.status === 'accepted').length} color="#00A3BF" />
        <MetricCard label="COMPLETED" value={visible.filter((t) => t.status === 'completed').length} color="#00875A" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Sel value={selPat} onChange={(e) => setSelPat(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="all">All Patients</option>
          {ptOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
        {selPat !== 'all' && <GhostBtn onClick={() => setSelPat('all')}>Clear</GhostBtn>}
      </div>

      {loading ? (
        <Spinner />
      ) : viewMode === 'roadmap' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {PHASES.map((ph) => {
            const items = visible.filter((t) => t.phase === ph.n);
            return (
              <div key={ph.n}>
                <div
                  className="card"
                  style={{
                    padding: '14px 18px',
                    marginBottom: 0,
                    borderRadius: '8px 8px 0 0',
                    borderTop: `3px solid ${ph.color}`,
                    borderBottom: 'none',
                    boxShadow: 'none',
                    border: `1px solid #DFE1E6`,
                    borderTopWidth: 3,
                    borderTopColor: ph.color,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: ph.color,
                          letterSpacing: '.08em',
                          marginBottom: 2,
                        }}
                      >
                        PHASE {ph.n}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: '#172B4D',
                          fontFamily: '"Plus Jakarta Sans",sans-serif',
                        }}
                      >
                        {ph.label}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#97A0AF' }}>{items.length} items</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: ph.color }}>
                        ${items.reduce((a, t) => a + Number(t.fee), 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    background: '#F4F7FA',
                    border: '1px solid #DFE1E6',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: 8,
                    minHeight: 100,
                  }}
                >
                  {items.map((t) => (
                    <div
                      key={t.id}
                      className="card mb-2"
                      style={{ padding: '12px 14px', boxShadow: 'none', border: '1px solid #DFE1E6' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span
                          style={{
                            background: ph.bg,
                            color: ph.color,
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {t.treatment_code || 'Geral'}
                        </span>
                        <Badge s={t.status} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D', marginBottom: 3 }}>
                        {t.description}
                      </div>
                      <div style={{ fontSize: 11, color: '#97A0AF', marginBottom: 8 }}>
                        {t.treatment_code || '—'} ·{' '}
                        <strong style={{ color: '#172B4D' }}>${Number(t.fee).toLocaleString()}</strong>
                        {t.patient_name && <span style={{ color: '#00A3BF' }}> · {t.patient_name}</span>}
                      </div>
                      <select
                        onChange={(e) => update(t.id, { status: e.target.value })}
                        defaultValue={t.status}
                        style={{
                          width: '100%',
                          border: '1px solid #DFE1E6',
                          borderRadius: 5,
                          padding: '5px 8px',
                          fontSize: 11,
                          fontFamily: 'inherit',
                          color: '#172B4D',
                          background: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="proposed">Proposed</option>
                        <option value="accepted">Accepted</option>
                        <option value="completed">Completed</option>
                      </select>
                    </div>
                  ))}
                  {!items.length && (
                    <div
                      style={{
                        border: '2px dashed #DFE1E6',
                        borderRadius: 6,
                        padding: '24px 0',
                        textAlign: 'center',
                        fontSize: 12,
                        color: '#C1C7D0',
                        margin: 4,
                      }}
                    >
                      No treatments in this phase
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <TreatmentTable treatments={visible} showPatient onUpdate={update} onDelete={del} />
        </div>
      )}

      {modal && (
        <Modal title="New Treatment" onClose={() => setModal(false)} width={540}>
          <FormField label="Patient *">
            <Sel value={form.patientId} onChange={(e) => setForm((p) => ({ ...p, patientId: e.target.value }))}>
              <option value="">— Select patient —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} #{p.global_seq}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Código TANOMD">
            <Sel
              value={form.treatmentCode}
              onChange={(e) => {
                const tc = TANOMD_CODES.find((a) => a.code === e.target.value);
                setForm((p) => ({
                  ...p,
                  treatmentCode: e.target.value,
                  description: tc?.desc || p.description,
                  fee: tc?.fee != null ? String(tc.fee) : p.fee,
                }));
              }}
            >
              <option value="">— Select code (optional) —</option>
              {TANOMD_CODES.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.desc} — ${a.fee}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Description *">
            <Inp
              value={form.description}
              placeholder="Procedure description"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Phase">
              <Sel value={form.phase} onChange={(e) => setForm((p) => ({ ...p, phase: e.target.value }))}>
                <option value="1">1 — Emergency</option>
                <option value="2">2 — Restorative</option>
                <option value="3">3 — Aesthetic</option>
              </Sel>
            </FormField>
            <FormField label="Fee ($)">
              <Inp
                type="number"
                value={form.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <Inp
              value={form.notes}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.patientId || !form.description}>
              {saving ? 'Creating…' : 'Create Treatment'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
