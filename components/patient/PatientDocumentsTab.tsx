'use client';
import { type Dispatch, type SetStateAction, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Badge, Empty, FormField, GhostBtn, Modal, PrimaryBtn, Sel } from '@/components/ui';
import type { PatientTask } from '@/lib/types';

interface UploadRow {
  id: string;
  url: string;
  category: string;
  content_type: string | null;
  size: number;
  created_at: string;
  task_id: string | null;
}

interface PatientDocumentsTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  patientId: string;
  tasks: PatientTask[];
  setTasks: Dispatch<SetStateAction<PatientTask[]>>;
  uploads: UploadRow[];
  setUploads: Dispatch<SetStateAction<UploadRow[]>>;
}

const CATEGORY_LABELS: Record<string, string> = {
  id_document: 'Documento de identificação',
  xray: 'Radiografia',
  consent: 'Consentimento',
  insurance: 'Seguro',
  lab_result: 'Resultado de laboratório',
  other: 'Outro',
};

async function uploadFile(
  file: File,
  patientId: string,
  category: string,
  taskId: string | null,
): Promise<{ url: string; name: string; size: number; type: string; uploadId: string; category: string }> {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('patientId', patientId);
  fd.set('category', category);
  if (taskId) fd.set('taskId', taskId);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || data?.error || 'Falha ao carregar ficheiro.');
  }
  return res.json();
}

export default function PatientDocumentsTab({
  api,
  patientId,
  tasks,
  setTasks,
  uploads,
  setUploads,
}: PatientDocumentsTabProps) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestCategory, setRequestCategory] = useState('id_document');
  const [requestSaving, setRequestSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [error, setError] = useState('');

  const pendingRequests = tasks.filter((t) => t.type === 'document_request' && t.status === 'pending');

  async function requestDocument() {
    setRequestSaving(true);
    setError('');
    try {
      const row = await api('/patient-tasks', {
        method: 'POST',
        body: {
          patientId,
          type: 'document_request',
          title: `Pedido de documento: ${CATEGORY_LABELS[requestCategory]}`,
          notes: requestCategory,
        },
      });
      setTasks((prev) => [row, ...(prev || [])]);
      setRequestOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao pedir documento.');
    } finally {
      setRequestSaving(false);
    }
  }

  async function handleUpload(file: File | null | undefined, category: string, taskId: string | null) {
    if (!file) return;
    setUploadingFor(taskId || 'general');
    setError('');
    try {
      const out = await uploadFile(file, patientId, category, taskId);
      setUploads((prev) => [
        {
          id: out.uploadId,
          url: out.url,
          category: out.category || category,
          content_type: out.type,
          size: out.size,
          created_at: new Date().toISOString(),
          task_id: taskId,
        },
        ...(prev || []),
      ]);
      if (taskId) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'done' as const } : t)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar ficheiro.');
    } finally {
      setUploadingFor(null);
    }
  }

  const grouped = uploads.reduce<Record<string, UploadRow[]>>((acc, u) => {
    const key = u.category || 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(u);
    return acc;
  }, {});

  return (
    <div>
      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="section-label">PEDIDOS PENDENTES ({pendingRequests.length})</div>
          <GhostBtn onClick={() => setRequestOpen(true)} style={{ padding: '6px 12px', fontSize: 12 }}>
            + Pedir documento
          </GhostBtn>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{error}</div>}
        {!pendingRequests.length ? (
          <Empty message="Sem pedidos pendentes." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingRequests.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid #DFE1E6',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div>
                  <Badge label="Pendente" bg="var(--amber-bg)" color="var(--amber)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#172B4D', marginLeft: 8 }}>{t.title}</span>
                </div>
                <input
                  type="file"
                  disabled={uploadingFor === t.id}
                  onChange={(e) => handleUpload(e.target.files?.[0] || null, t.notes || 'other', t.id)}
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  style={{ fontSize: 12, maxWidth: 220 }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="section-label">DOCUMENTOS ({uploads.length})</div>
          <label
            style={{
              fontSize: 12,
              color: 'var(--brand)',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {uploadingFor === 'general' ? 'A carregar…' : '+ Carregar documento'}
            <input
              type="file"
              hidden
              disabled={uploadingFor === 'general'}
              onChange={(e) => handleUpload(e.target.files?.[0] || null, 'other', null)}
              accept="image/png,image/jpeg,image/webp,application/pdf"
            />
          </label>
        </div>
        {!uploads.length ? (
          <Empty message="Sem documentos carregados." />
        ) : (
          Object.entries(grouped).map(([category, rows]) => (
            <div key={category} style={{ marginBottom: 18 }}>
              <div className="section-label mb-2">{CATEGORY_LABELS[category] || category}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#F4F7FA',
                      border: '1px solid #EBECF0',
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}
                  >
                    <a
                      href={u.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: '#0052CC', fontWeight: 700 }}
                    >
                      {u.url.split('/').pop()}
                    </a>
                    <span style={{ fontSize: 11, color: '#97A0AF' }}>
                      {new Date(u.created_at).toLocaleDateString('pt-PT')} · Recebido
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {requestOpen && (
        <Modal title="Pedir documento" onClose={() => setRequestOpen(false)}>
          <FormField label="Categoria">
            <Sel value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <GhostBtn onClick={() => setRequestOpen(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={requestDocument} disabled={requestSaving}>
              {requestSaving ? 'A pedir…' : 'Pedir'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
