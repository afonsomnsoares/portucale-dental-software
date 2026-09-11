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
  Spinner,
  Textarea,
} from '@/components/ui';
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect';
import type { ConsentForm, Patient } from '@/lib/types';

interface NewConsentForm {
  procedureName: string;
  description: string;
  signedBy: string;
  signatureUrl: string;
}

export default function ConsentFormsPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<ConsentForm[]>([]);
  const [modal, setModal] = useState(false);
  const [detailModal, setDetailModal] = useState<ConsentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewConsentForm>({
    procedureName: '',
    description: '',
    signedBy: '',
    signatureUrl: '',
  });

  const select = useCallback((p: Patient) => {
    setSelected(p);
    setForm((prev) => ({ ...prev, signedBy: p.name || '' }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const pts = await api('/patients').catch(() => []);
    setPatients(pts || []);
    if (!selected && pts?.length) select(pts[0]);
    setLoading(false);
  }, [api, selected, select]);

  useDebouncedEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) {
      api(`/consent-forms?patientId=${selected.id}`)
        .then(setForms)
        .catch(() => setForms([]));
    }
  }, [selected, api]);

  useEffect(() => {
    if (selected) setForm((prev) => ({ ...prev, signedBy: selected.name || prev.signedBy }));
  }, [selected]);

  async function create() {
    if (!form.procedureName || !form.signedBy || !selected) return;
    setSaving(true);
    const f = await api('/consent-forms', {
      method: 'POST',
      body: { patientId: selected.id, ...form },
    }).catch(() => null);
    if (f) {
      setForms((prev) => [f, ...prev]);
      setModal(false);
      setForm({ procedureName: '', description: '', signedBy: selected?.name || '', signatureUrl: '' });
    }
    setSaving(false);
  }

  const cols = ['Procedimento', 'Assinado por', 'Estado', 'Ações'];

  return (
    <div>
      <PageHeader title="Consentimentos" sub="Consentimento informado por procedimento, com registo da assinatura" />
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
              <PrimaryBtn onClick={() => setModal(true)}>+ Novo Consentimento</PrimaryBtn>
            </div>
            {!forms.length ? (
              <Empty message="Sem consentimentos" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={forms.map((f) => (
                    <tr key={f.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {f.procedure_name}
                      </td>
                      <td className="data-td">{f.signed_by}</td>
                      <td className="data-td">
                        <Badge s="signed" />
                      </td>
                      <td className="data-td">
                        <GhostBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => setDetailModal(f)}>
                          Ver
                        </GhostBtn>
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Selecione um doente para ver os consentimentos" />
        )}
      </div>

      {modal && (
        <Modal title="Novo Consentimento" onClose={() => setModal(false)} width={540}>
          <FormField label="Procedimento *">
            <Inp
              value={form.procedureName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, procedureName: e.target.value }))}
              placeholder="Ex: Extração do 38"
            />
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Riscos, alternativas e cuidados explicados ao doente…"
            />
          </FormField>
          <FormField label="Assinado por (nome do doente) *">
            <Inp
              value={form.signedBy}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, signedBy: e.target.value }))}
              placeholder="Nome do doente"
            />
          </FormField>
          <FormField label="Ligação ao documento assinado">
            <Inp
              value={form.signatureUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, signatureUrl: e.target.value }))}
              placeholder="https://…"
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.procedureName || !form.signedBy}>
              {saving ? 'A registar…' : 'Registar Consentimento'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}

      {detailModal && (
        <Modal title={detailModal.procedure_name} onClose={() => setDetailModal(null)} width={540}>
          <div style={{ display: 'grid', gap: 14 }}>
            {detailModal.description && (
              <div>
                <div className="section-label mb-1">Descrição</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{detailModal.description}</p>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="section-label mb-1">Assinado por</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {detailModal.signed_by}
                </div>
              </div>
              <div>
                <div className="section-label mb-1">Data da assinatura</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {detailModal.created_at ? new Date(detailModal.created_at).toLocaleDateString('pt-PT') : '—'}
                </div>
              </div>
            </div>
            {detailModal.signature_url && (
              <div>
                <div className="section-label mb-1">Documento assinado</div>
                <a
                  href={detailModal.signature_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
                >
                  Abrir PDF da assinatura ↗
                </a>
              </div>
            )}
            <div>
              <div className="section-label mb-1">Estado</div>
              <Badge s="signed" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <GhostBtn onClick={() => setDetailModal(null)}>Fechar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
