'use client';
import { type ChangeEvent, useEffect, useState } from 'react';
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
  PrimaryBtn,
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

export default function PatientConsentimentosTab({ patient }: { patient: Patient }) {
  const { api } = useAuth();
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

  const pid = patient.id;
  const formsQuery = useQuery<ConsentForm[]>(`/consent-forms?patientId=${pid}`);
  const forms = formsQuery.data ?? [];

  useEffect(() => {
    if (patient) setForm((prev) => ({ ...prev, signedBy: patient.name || prev.signedBy }));
  }, [patient]);

  async function create() {
    if (!form.procedureName || !form.signedBy || !patient) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/consent-forms', {
        method: 'POST',
        body: { patientId: patient.id, ...form },
      });
      formsQuery.refetch();
      setModal(false);
      setForm({ procedureName: '', description: '', signedBy: patient.name || '', signatureUrl: '' });
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível registar o consentimento.');
    }
    setSaving(false);
  }

  const cols = ['Procedimento', 'Assinado por', 'Estado', 'Ações'];

  return (
    <div>
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {formsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler os consentimentos deste doente. {formsQuery.error.message}
        </AlertBanner>
      ) : null}

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
