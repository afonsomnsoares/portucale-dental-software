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
import { formatEUR } from '@/lib/constants';
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

  const cols = ['Título', 'Valor Total', 'Estado', 'Criado', 'Ações'];

  return (
    <div>
      <PageHeader title="Planos de Tratamento" sub="Planos por fases, com valor apresentado ao doente" />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bg-sunken)' }}>
            <input
              className="input"
              placeholder="Procurar por nome ou nº…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
            {loading ? (
              <Spinner />
            ) : !patients.length ? (
              <Empty message="Sem doentes" />
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
                    borderBottom: '1px solid var(--bg-page)',
                    background: selected?.id === p.id ? 'var(--accent-bg)' : 'white',
                    borderLeft: `3px solid ${selected?.id === p.id ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
              <PrimaryBtn onClick={() => setModal(true)}>+ Novo Plano</PrimaryBtn>
            </div>
            {!plans.length ? (
              <Empty message="Sem planos de tratamento" />
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
                        {formatEUR(Number(p.total_fee || 0))}
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
                          Ver
                        </GhostBtn>
                        {p.status === 'draft' && (
                          <PrimaryBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => approve(p.id)}>
                            Aprovar
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
          <Empty message="Selecione um doente para ver os planos" />
        )}
      </div>

      {modal && (
        <Modal title="Novo Plano de Tratamento" onClose={() => setModal(false)} width={560}>
          <FormField label="Título *">
            <Inp
              value={form.title}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Ex: Reabilitação do 2.º quadrante"
            />
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="O que o plano cobre, por palavras do clínico…"
            />
          </FormField>
          <div className="section-label mb-2">Fases</div>
          {form.phases.map((ph, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: phases have no id; index matches updatePhase/removePhase's own indexing
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div
                style={{ width: 60, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', paddingBottom: 10 }}
              >
                Fase {ph.phase}
              </div>
              <Inp
                placeholder="Descrição da fase"
                value={ph.description}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updatePhase(i, 'description', e.target.value)}
                style={{ flex: 1 }}
              />
              <Inp
                type="number"
                placeholder="Valor €"
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
            + Acrescentar fase
          </GhostBtn>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
            Valor total: {formatEUR(totalFee)}
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.title}>
              {saving ? 'A criar…' : 'Criar Plano'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}

      {detailModal && (
        <Modal title={detailModal.title} onClose={() => setDetailModal(null)} width={560}>
          {detailModal.description && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{detailModal.description}</p>
          )}
          <div className="section-label mb-2">Fases</div>
          {(detailModal.phases || []).map((ph, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: phases have no id and this list is static (read-only detail view)
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--bg-page)',
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 8 }}>
                  FASE {ph.phase}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{ph.description}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatEUR(Number(ph.fee || 0))}
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
              color: 'var(--text-primary)',
              borderTop: '2px solid var(--border-subtle)',
              marginTop: 8,
            }}
          >
            <span>Total</span>
            <span>{formatEUR(Number(detailModal.total_fee || 0))}</span>
          </div>
          {detailModal.approved_by && (
            <AlertBanner type="success">
              Aprovado por {detailModal.approved_by} em{' '}
              {detailModal.approved_at ? new Date(detailModal.approved_at).toLocaleDateString('pt-PT') : '—'}
            </AlertBanner>
          )}
          <div className="flex gap-3 mt-2">
            <GhostBtn onClick={() => setDetailModal(null)}>Fechar</GhostBtn>
            {detailModal.status === 'draft' && (
              <PrimaryBtn
                onClick={async () => {
                  await approve(detailModal.id);
                  setDetailModal(null);
                }}
              >
                Aprovar
              </PrimaryBtn>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
