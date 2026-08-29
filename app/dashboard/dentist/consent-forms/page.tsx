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

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
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

  const cols = ['Procedure', 'Patient Signed', 'Status', 'Actions'];

  return (
    <div>
      <PageHeader title="Consent Forms" sub="Patient consent forms — digital signatures and records" />
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
              <PrimaryBtn onClick={() => setModal(true)}>+ New Consent Form</PrimaryBtn>
            </div>
            {!forms.length ? (
              <Empty message="No consent forms" />
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
                          View
                        </GhostBtn>
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view consent forms" />
        )}
      </div>

      {modal && (
        <Modal title="New Consent Form" onClose={() => setModal(false)} width={540}>
          <FormField label="Procedure Name *">
            <Inp
              value={form.procedureName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, procedureName: e.target.value }))}
              placeholder="Procedure name"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Procedure description…"
            />
          </FormField>
          <FormField label="Signed By (Patient Name) *">
            <Inp
              value={form.signedBy}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, signedBy: e.target.value }))}
              placeholder="Patient name"
            />
          </FormField>
          <FormField label="Signature URL">
            <Inp
              value={form.signatureUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, signatureUrl: e.target.value }))}
              placeholder="https://…"
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.procedureName || !form.signedBy}>
              {saving ? 'Creating…' : 'Create Consent Form'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}

      {detailModal && (
        <Modal title={detailModal.procedure_name} onClose={() => setDetailModal(null)} width={540}>
          <div style={{ display: 'grid', gap: 14 }}>
            {detailModal.description && (
              <div>
                <div className="section-label mb-1">Description</div>
                <p style={{ fontSize: 13, color: '#5E6C84' }}>{detailModal.description}</p>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="section-label mb-1">Signed By</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#172B4D' }}>{detailModal.signed_by}</div>
              </div>
              <div>
                <div className="section-label mb-1">Date Signed</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#172B4D' }}>
                  {detailModal.created_at ? new Date(detailModal.created_at).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>
            {detailModal.signature_url && (
              <div>
                <div className="section-label mb-1">Signature Document</div>
                <a
                  href={detailModal.signature_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: '#0052CC', fontWeight: 600, textDecoration: 'none' }}
                >
                  View Signature PDF ↗
                </a>
              </div>
            )}
            <div>
              <div className="section-label mb-1">Status</div>
              <Badge s="signed" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <GhostBtn onClick={() => setDetailModal(null)}>Close</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
