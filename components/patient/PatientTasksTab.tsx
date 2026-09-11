'use client';
import { type ChangeEvent, useState } from 'react';
import type { ApiOptions, AuthUser } from '@/app/providers';
import { Badge, DangerBtn, Empty, FormField, GhostBtn, Inp, PrimaryBtn, Sel, Textarea } from '@/components/ui';
import type { PatientTask, PatientTaskType } from '@/lib/types';

interface PatientTasksTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  user: AuthUser | null;
  patientId: string;
  tasks: PatientTask[];
  onChanged: () => void;
}

const TYPE_LABELS: Record<PatientTaskType, string> = {
  generic: 'Geral',
  call: 'Ligar',
  document_request: 'Pedido de documento',
  follow_up: 'Follow-up',
  data_missing: 'Dados em falta',
};

// Tasks this generic type can back a self-service portal link for — 'document_request'
// maps to the document_upload purpose (and auto-closes this exact task on submission),
// 'data_missing' maps to missing_data (see app/api/public/patient-portal/[token]).
const PORTAL_PURPOSE: Partial<Record<PatientTaskType, 'document_upload' | 'missing_data'>> = {
  document_request: 'document_upload',
  data_missing: 'missing_data',
};

export default function PatientTasksTab({ api, user, patientId, tasks, onChanged }: PatientTasksTabProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PatientTaskType>('generic');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assignToMe, setAssignToMe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [linkByTask, setLinkByTask] = useState<Record<string, string>>({});

  async function create() {
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api('/patient-tasks', {
        method: 'POST',
        body: {
          patientId,
          type,
          title: title.trim(),
          notes,
          dueAt: dueAt || null,
          assignedTo: assignToMe ? user?.id : null,
        },
      });
      onChanged();
      setTitle('');
      setNotes('');
      setDueAt('');
      setType('generic');
      setAssignToMe(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar tarefa.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, patch: { complete?: boolean; cancel?: boolean }) {
    setError('');
    try {
      await api(`/patient-tasks/${id}`, { method: 'PUT', body: patch });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível atualizar a tarefa.');
    }
  }

  // Item 4 — "enviar formulários"/"pedir documentos": mints a single-use link
  // (app/api/patient-portal-links) the patient can open without a login to fill in
  // missing data or upload the document this task asked for. Submitting it auto-closes
  // this exact task (document_upload purpose only — see the API route) and drops a
  // review task in the team queue.
  async function generatePortalLink(t: PatientTask) {
    const purpose = PORTAL_PURPOSE[t.type];
    if (!purpose) return;
    setLinkBusyId(t.id);
    try {
      const res = await api('/patient-portal-links', {
        method: 'POST',
        body: { patientId, purpose, taskId: purpose === 'document_upload' ? t.id : undefined },
      });
      const fullUrl = `${window.location.origin}${res.url}`;
      setLinkByTask((m) => ({ ...m, [t.id]: fullUrl }));
      try {
        await navigator.clipboard.writeText(fullUrl);
      } catch {
        /* clipboard unavailable — the link is still shown below for manual copy */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar link.');
    } finally {
      setLinkBusyId(null);
    }
  }

  const open = tasks.filter((t) => t.status === 'pending');
  const closed = tasks.filter((t) => t.status !== 'pending');

  return (
    <div className="grid-pair" style={{ gap: 16 }}>
      <div className="card p-5">
        <div className="section-label mb-3">NOVA TAREFA</div>
        <div className="grid-pair" style={{ gap: 12 }}>
          <FormField label="Tipo">
            <Sel value={type} onChange={(e) => setType(e.target.value as PatientTaskType)}>
              {Object.entries(TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Prazo (opcional)">
            <Inp type="date" value={dueAt} onChange={(e: ChangeEvent<HTMLInputElement>) => setDueAt(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Título">
          <Inp
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="ex: Ligar a confirmar consulta"
          />
        </FormField>
        <FormField label="Notas (opcional)">
          <Textarea
            value={notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            style={{ minHeight: 60 }}
          />
        </FormField>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', marginBottom: 12 }}>
          <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} />
          Atribuir a mim
        </label>
        {error && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--urgency-critical)',
              fontWeight: 'var(--weight-bold)',
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <PrimaryBtn onClick={create} disabled={saving || !title.trim()} style={{ justifyContent: 'center' }}>
          {saving ? 'A criar…' : 'Criar tarefa'}
        </PrimaryBtn>
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">EM ABERTO ({open.length})</div>
        {!open.length ? (
          <Empty message="Sem tarefas em aberto." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: closed.length ? 24 : 0 }}>
            {open.map((t) => (
              <div
                key={t.id}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-control)',
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <Badge bg="var(--accent-bg)" color="var(--accent)" label={TYPE_LABELS[t.type]} />
                      {t.due_at && (
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                          Prazo: {new Date(t.due_at).toLocaleDateString('pt-PT')}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {t.title}
                    </div>
                    {t.notes && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {t.notes}
                      </div>
                    )}
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                      {t.assigned_to_name ? `Atribuído a ${t.assigned_to_name}` : 'Fila da equipa'}
                    </div>
                    {linkByTask[t.id] && (
                      <div
                        style={{
                          fontSize: 'var(--text-2xs)',
                          color: 'var(--accent)',
                          marginTop: 8,
                          wordBreak: 'break-all',
                        }}
                      >
                        Link copiado: {linkByTask[t.id]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {PORTAL_PURPOSE[t.type] && (
                      <GhostBtn
                        onClick={() => generatePortalLink(t)}
                        disabled={linkBusyId === t.id}
                        style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                      >
                        {linkBusyId === t.id ? '…' : 'Gerar link'}
                      </GhostBtn>
                    )}
                    <GhostBtn
                      onClick={() => setStatus(t.id, { complete: true })}
                      style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                    >
                      Concluir
                    </GhostBtn>
                    <DangerBtn
                      onClick={() => setStatus(t.id, { cancel: true })}
                      style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                    >
                      Cancelar
                    </DangerBtn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {closed.length > 0 && (
          <>
            <div className="section-label mb-3">HISTÓRICO ({closed.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {closed.map((t) => (
                <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: 0.6 }}>
                  <Badge
                    label={t.status === 'done' ? 'Concluída' : 'Cancelada'}
                    bg={t.status === 'done' ? 'var(--urgency-ok-bg)' : 'var(--bg-sunken)'}
                    color={t.status === 'done' ? 'var(--urgency-ok)' : 'var(--text-secondary)'}
                  />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{t.title}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
