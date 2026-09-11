'use client';
import { type ChangeEvent, useState } from 'react';
import { useAuth } from '@/app/providers';
import TreatmentTable from '@/components/TreatmentTable';
import {
  AlertBanner,
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
import { useQuery } from '@/hooks/useQuery';
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
  { n: 1, label: 'Emergency', color: 'var(--urgency-critical)', bg: 'var(--urgency-critical-bg)' },
  { n: 2, label: 'Restorative', color: 'var(--accent)', bg: 'var(--accent-bg)' },
  { n: 3, label: 'Aesthetic', color: 'var(--cat-purple)', bg: 'var(--cat-purple-bg)' },
];

export default function DentistTreatmentsPage() {
  const { api, settings } = useAuth();
  const TANOMD_CODES = settings?.TANOMD_CODES || [];
  const treatmentsQuery = useQuery<Treatment[]>('/treatments');
  const patientsQuery = useQuery<Patient[]>('/patients');
  const treatments = treatmentsQuery.data ?? [];
  const patients = patientsQuery.data ?? [];
  const [erro, setErro] = useState('');
  const [selPat, setSelPat] = useState('all');
  const [viewMode, setViewMode] = useState('roadmap');
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

  async function create() {
    if (!form.patientId || !form.description) return;
    setSaving(true);
    setErro('');
    try {
      await api('/treatments', {
        method: 'POST',
        body: {
          patientId: form.patientId,
          treatmentCode: form.treatmentCode || null,
          description: form.description,
          phase: Number(form.phase),
          fee: Number(form.fee) || 0,
          notes: form.notes,
        },
      });
      treatmentsQuery.refetch();
      setModal(false);
      setForm({ patientId: '', treatmentCode: '', description: '', phase: '1', fee: '', notes: '' });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registar o tratamento.');
    }
    setSaving(false);
  }

  async function update(id: string, body: Record<string, unknown>) {
    setErro('');
    try {
      await api(`/treatments/${id}`, { method: 'PUT', body });
      treatmentsQuery.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível atualizar o tratamento.');
    }
  }
  async function del(id: string) {
    setErro('');
    try {
      await api(`/treatments/${id}`, { method: 'DELETE' });
      treatmentsQuery.refetch();
    } catch (e) {
      // Este era o pior dos três: apagava a linha do ecrã SEM esperar pela
      // resposta e sem a repor se o servidor recusasse. O tratamento continuava
      // na base de dados e desaparecia da vista de quem o apagou.
      setErro(e instanceof Error ? e.message : 'Não foi possível apagar o tratamento.');
    }
  }

  const visible = selPat === 'all' ? treatments : treatments.filter((t) => t.patient_id === selPat);
  const ptOptions = patients.filter((p) => treatments.some((t) => t.patient_id === p.id));

  return (
    <div>
      <PageHeader
        title="Tratamentos"
        sub="Gestão de tratamentos — todos os doentes"
        action="+ Novo tratamento"
        onAction={() => setModal(true)}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {['roadmap', 'table'].map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '7px 14px',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                borderRadius: 'var(--radius-control)',
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                background: viewMode === m ? 'var(--accent)' : 'white',
                color: viewMode === m ? 'white' : 'var(--text-secondary)',
                boxShadow: viewMode !== m ? 'var(--elev-1)' : 'var(--elev-0)',
              }}
            >
              {m === 'roadmap' ? 'Phase View' : 'Table View'}
            </button>
          ))}
        </div>
      </PageHeader>
      {erro ? <AlertBanner type="danger">{erro}</AlertBanner> : null}
      {treatmentsQuery.error ? (
        <AlertBanner type="danger">Não foi possível ler os tratamentos. {treatmentsQuery.error.message}</AlertBanner>
      ) : null}

      <div className="grid-cards" style={{ gap: 12, marginBottom: 20 }}>
        <MetricCard
          label="VALOR TOTAL"
          value={`$${visible.reduce((a, t) => a + Number(t.fee), 0).toLocaleString()}`}
          color="var(--accent)"
        />
        <MetricCard
          label="PROPOSTOS"
          value={visible.filter((t) => t.status === 'proposed').length}
          color="var(--urgency-soon)"
        />
        <MetricCard
          label="EM CURSO"
          value={visible.filter((t) => t.status === 'accepted').length}
          color="var(--cat-teal)"
        />
        <MetricCard
          label="CONCLUÍDOS"
          value={visible.filter((t) => t.status === 'completed').length}
          color="var(--urgency-ok)"
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Sel value={selPat} onChange={(e) => setSelPat(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="all">Todos os doentes</option>
          {ptOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
        {selPat !== 'all' && <GhostBtn onClick={() => setSelPat('all')}>Limpar</GhostBtn>}
      </div>

      {treatmentsQuery.loading ? (
        <Spinner />
      ) : viewMode === 'roadmap' ? (
        <div className="grid-cards" style={{ gap: 16 }}>
          {PHASES.map((ph) => {
            const items = visible.filter((t) => t.phase === ph.n);
            return (
              <div key={ph.n}>
                <div
                  className="card"
                  style={{
                    padding: '14px 18px',
                    marginBottom: 0,
                    borderRadius: 'var(--radius-card) var(--radius-card) 0 0',
                    borderTop: `3px solid ${ph.color}`,
                    borderBottom: 'none',
                    border: `1px solid var(--border-subtle)`,
                    borderTopWidth: 3,
                    borderTopColor: ph.color,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div
                        style={{
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 'var(--weight-bold)',
                          color: ph.color,
                          letterSpacing: '.08em',
                          marginBottom: 2,
                        }}
                      >
                        PHASE {ph.n}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-base)',
                          fontWeight: 'var(--weight-bold)',
                          color: 'var(--text-primary)',
                          fontFamily: '"Plus Jakarta Sans",sans-serif',
                        }}
                      >
                        {ph.label}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                        {items.length} items
                      </div>
                      <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: ph.color }}>
                        ${items.reduce((a, t) => a + Number(t.fee), 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    background: 'var(--bg-page)',
                    border: '1px solid var(--border-subtle)',
                    borderTop: 'none',
                    borderRadius: '0 0 var(--radius-card) var(--radius-card)',
                    padding: 8,
                    minHeight: 100,
                  }}
                >
                  {items.map((t) => (
                    <div
                      key={t.id}
                      className="card mb-2"
                      style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span
                          style={{
                            background: ph.bg,
                            color: ph.color,
                            borderRadius: 'var(--radius-control)',
                            padding: '2px 8px',
                            fontSize: 'var(--text-2xs)',
                            fontWeight: 'var(--weight-bold)',
                          }}
                        >
                          {t.treatment_code || 'Geral'}
                        </span>
                        <Badge s={t.status} />
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--text-primary)',
                          marginBottom: 3,
                        }}
                      >
                        {t.description}
                      </div>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 8 }}>
                        {t.treatment_code || '—'} ·{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>${Number(t.fee).toLocaleString()}</strong>
                        {t.patient_name && <span style={{ color: 'var(--cat-teal)' }}> · {t.patient_name}</span>}
                      </div>
                      <select
                        onChange={(e) => update(t.id, { status: e.target.value })}
                        defaultValue={t.status}
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-control)',
                          padding: '5px 8px',
                          fontSize: 'var(--text-2xs)',
                          fontFamily: 'inherit',
                          color: 'var(--text-primary)',
                          background: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="proposed">Propostos</option>
                        <option value="accepted">Aceites</option>
                        <option value="completed">Concluído</option>
                      </select>
                    </div>
                  ))}
                  {!items.length && (
                    <div
                      style={{
                        border: '2px dashed var(--border-subtle)',
                        borderRadius: 'var(--radius-control)',
                        padding: '24px 0',
                        textAlign: 'center',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-muted)',
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
        <Modal title="Novo tratamento" onClose={() => setModal(false)} width={540}>
          <FormField label="Doente *">
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
          <FormField label="Descrição *">
            <Inp
              value={form.description}
              placeholder="Descrição do procedimento"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </FormField>
          <div className="grid-pair" style={{ gap: 12 }}>
            <FormField label="Fase">
              <Sel value={form.phase} onChange={(e) => setForm((p) => ({ ...p, phase: e.target.value }))}>
                <option value="1">1 — Emergency</option>
                <option value="2">2 — Restorative</option>
                <option value="3">3 — Aesthetic</option>
              </Sel>
            </FormField>
            <FormField label="Valor (€)">
              <Inp
                type="number"
                value={form.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notas">
            <Inp
              value={form.notes}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.patientId || !form.description}>
              {saving ? 'Creating…' : 'Create Treatment'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
