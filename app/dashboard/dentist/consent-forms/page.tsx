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
import { useQuery } from '@/hooks/useQuery';
import type { ConsentForm, Patient } from '@/lib/types';

interface NewConsentForm {
  procedureName: string;
  description: string;
  signedBy: string;
  signatureUrl: string;
}

export default function ConsentFormsPage() {
  const { api } = useAuth();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [detailModal, setDetailModal] = useState<ConsentForm | null>(null);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
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

  const patientsQuery = useQuery<Patient[]>('/patients');
  const patients = patientsQuery.data ?? [];

  // O primeiro doente abre sozinho, e só enquanto ninguém tiver escolhido.
  useEffect(() => {
    if (!selected && patients.length) select(patients[0]);
  }, [selected, patients, select]);

  // `null` enquanto não houver doente escolhido: o hook espera em vez de
  // pedir um caminho com `undefined` lá dentro.
  const pid = selected?.id ?? null;
  const formsQuery = useQuery<ConsentForm[]>(pid ? `/consent-forms?patientId=${pid}` : null);
  const forms = formsQuery.data ?? [];

  useEffect(() => {
    if (selected) setForm((prev) => ({ ...prev, signedBy: selected.name || prev.signedBy }));
  }, [selected]);

  async function create() {
    if (!form.procedureName || !form.signedBy || !selected) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/consent-forms', {
        method: 'POST',
        body: { patientId: selected.id, ...form },
      });
      formsQuery.refetch();
      setModal(false);
      setForm({ procedureName: '', description: '', signedBy: selected?.name || '', signatureUrl: '' });
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível registar o consentimento.');
    }
    setSaving(false);
  }

  const cols = ['Procedimento', 'Assinado por', 'Estado', 'Ações'];

  return (
    <div>
      <PageHeader title="Consentimentos" sub="Consentimento informado por procedimento, com registo da assinatura" />
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {formsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler os consentimentos deste doente. {formsQuery.error.message}
        </AlertBanner>
      ) : null}
      <div className="grid-sidebar" style={{ gap: 16 }}>
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
            {patientsQuery.loading ? (
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
                  <div
                    style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-semibold)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
                      <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                        {f.procedure_name}
                      </td>
                      <td className="data-td">{f.signed_by}</td>
                      <td className="data-td">
                        <Badge s="signed" />
                      </td>
                      <td className="data-td">
                        <GhostBtn
                          style={{ padding: '4px 12px', fontSize: 'var(--text-2xs)' }}
                          onClick={() => setDetailModal(f)}
                        >
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
          <div style={{ display: 'grid', gap: 12 }}>
            {detailModal.description && (
              <div>
                <div className="section-label mb-1">Descrição</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{detailModal.description}</p>
              </div>
            )}
            <div className="grid-pair" style={{ gap: 12 }}>
              <div>
                <div className="section-label mb-1">Assinado por</div>
                <div
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {detailModal.signed_by}
                </div>
              </div>
              <div>
                <div className="section-label mb-1">Data da assinatura</div>
                <div
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                  }}
                >
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
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--accent)',
                    fontWeight: 'var(--weight-semibold)',
                    textDecoration: 'none',
                  }}
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
