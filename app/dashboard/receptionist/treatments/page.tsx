'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import TreatmentTable from '@/components/TreatmentTable';
import { FormField, GhostBtn, Inp, MetricCard, Modal, PageHeader, PrimaryBtn, Sel, Spinner } from '@/components/ui';
import type { Patient, Treatment } from '@/lib/types';

interface NewTreatmentForm {
  patientId: string;
  treatmentCode: string;
  description: string;
  phase: string;
  fee: string;
  notes: string;
}

export default function ReceptionTreatmentsPage() {
  const { api, settings } = useAuth();
  const TANOMD_CODES = settings?.TANOMD_CODES || [];
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selPat, setSelPat] = useState('all');
  const [selPhase, setSelPhase] = useState('all');
  const [selStatus, setSelStatus] = useState('all');
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
    const [tr, pt] = await Promise.all([api('/treatments').catch(() => []), api('/patients').catch(() => [])]);
    setTreatments(tr || []);
    setPatients(pt || []);
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

  let visible = [...treatments];
  if (selPat !== 'all') visible = visible.filter((t) => t.patient_id === selPat);
  if (selPhase !== 'all') visible = visible.filter((t) => String(t.phase) === selPhase);
  if (selStatus !== 'all') visible = visible.filter((t) => t.status === selStatus);

  const totalFee = visible.reduce((a, t) => a + Number(t.fee), 0);
  const proposed = visible.filter((t) => t.status === 'proposed').length;
  const accepted = visible.filter((t) => t.status === 'accepted').length;
  const completed = visible.filter((t) => t.status === 'completed').length;
  const ptOptions = patients.filter((p) => treatments.some((t) => t.patient_id === p.id));

  return (
    <div>
      <PageHeader
        title="Treatment Plans"
        sub="Create, view, and manage all treatment plans"
        action="+ New Treatment"
        onAction={() => setModal(true)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard label="TOTAL VALUE" value={`$${totalFee.toLocaleString()}`} color="var(--accent)" />
        <MetricCard label="PROPOSED" value={proposed} sub="awaiting acceptance" color="var(--urgency-soon)" />
        <MetricCard label="ACCEPTED" value={accepted} sub="scheduled" color="var(--cat-teal)" />
        <MetricCard label="COMPLETED" value={completed} sub="completed treatments" color="var(--urgency-ok)" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Sel value={selPat} onChange={(e) => setSelPat(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">All Patients</option>
          {ptOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} #{p.global_seq}
            </option>
          ))}
        </Sel>
        <Sel value={selPhase} onChange={(e) => setSelPhase(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">All Phases</option>
          <option value="1">Phase 1 — Emergency</option>
          <option value="2">Phase 2 — Restorative</option>
          <option value="3">Phase 3 — Aesthetic</option>
        </Sel>
        <Sel value={selStatus} onChange={(e) => setSelStatus(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="all">All Statuses</option>
          <option value="proposed">Proposed</option>
          <option value="accepted">Accepted</option>
          <option value="completed">Completed</option>
        </Sel>
        {(selPat !== 'all' || selPhase !== 'all' || selStatus !== 'all') && (
          <GhostBtn
            onClick={() => {
              setSelPat('all');
              setSelPhase('all');
              setSelStatus('all');
            }}
          >
            Clear Filters
          </GhostBtn>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{visible.length} treatments</div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? <Spinner /> : <TreatmentTable treatments={visible} showPatient onUpdate={update} onDelete={del} />}
      </div>

      {modal && (
        <Modal title="Create New Treatment" onClose={() => setModal(false)} width={540}>
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
              <option value="">— Select procedure code (optional) —</option>
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
              placeholder="e.g. Composite Resin — Posterior"
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
                placeholder="0.00"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <Inp
              value={form.notes}
              placeholder="Optional"
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
