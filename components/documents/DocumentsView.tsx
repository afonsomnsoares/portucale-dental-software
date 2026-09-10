'use client';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import PatientsSidebarList from '@/components/shared/PatientsSidebarList';
import {
  AlertBanner,
  Badge,
  DangerBtn,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  Tabs,
  TD,
  Textarea,
} from '@/components/ui';
import type { Appointment, DocumentTemplate, DocumentTemplateType, GeneratedDocument, Patient } from '@/lib/types';

interface DocumentsViewProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  // Só admin/super_admin têm 'document-templates:manage' por omissão (ver
  // lib/permissions.ts) — o separador de modelos é escondido para os restantes em
  // vez de os deixar carregar em botões que a API vai recusar.
  canManageTemplates?: boolean;
}

const TYPE_LABEL: Record<DocumentTemplateType, string> = {
  declaration: 'Declaração',
  justification: 'Justificação',
  letter: 'Carta',
  other: 'Outro',
};

const EMPTY_TEMPLATE = { name: '', type: 'declaration' as DocumentTemplateType, subject: '', body: '' };

export default function DocumentsView({ api, canManageTemplates = false }: DocumentsViewProps) {
  const [tab, setTab] = useState('issue');
  const [loading, setLoading] = useState(true);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [variables, setVariables] = useState<Array<{ key: string; label: string }>>([]);
  const [templateId, setTemplateId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');

  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [preview, setPreview] = useState<GeneratedDocument | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const [templateModal, setTemplateModal] = useState<DocumentTemplate | 'new' | null>(null);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadTemplates = useCallback(async () => {
    const res = await api('/document-templates').catch(() => null);
    setTemplates(res?.templates || []);
    setVariables(res?.variables || []);
    if (res?.templates?.length) setTemplateId((prev) => prev || res.templates[0].id);
  }, [api]);

  const loadDocuments = useCallback(async () => {
    const rows = await api('/documents').catch(() => []);
    setDocuments(rows || []);
  }, [api]);

  useEffect(() => {
    (async () => {
      const [pts] = await Promise.all([api('/patients').catch(() => []), loadTemplates(), loadDocuments()]);
      setPatients(pts || []);
      setSelected((prev) => prev || pts?.[0] || null);
      setLoading(false);
    })();
  }, [api, loadTemplates, loadDocuments]);

  useEffect(() => {
    if (!selected) return;
    setAppointmentId('');
    api(`/appointments?patientId=${selected.id}&limit=50`)
      .then((rows: Appointment[]) => setAppointments(rows || []))
      .catch(() => setAppointments([]));
  }, [selected, api]);

  const visiblePatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => p.name?.toLowerCase().includes(q) || String(p.global_seq || '').includes(q));
  }, [patients, search]);

  const activeTemplate = templates.find((t) => t.id === templateId) || null;

  async function issue() {
    if (!selected || !templateId) return;
    setBusy(true);
    setError('');
    setMissing([]);
    try {
      const res = await api('/documents', {
        method: 'POST',
        body: { templateId, patientId: selected.id, appointmentId: appointmentId || null },
      });
      setPreview(res.document);
      setMissing(res.missing || []);
      setDocuments((prev) => [res.document, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao emitir documento.');
    } finally {
      setBusy(false);
    }
  }

  // Impressão sem dependências novas: uma janela só com o texto do documento e o
  // diálogo de impressão do browser. É o que a clínica faz com estes papéis —
  // imprimir, assinar, entregar — e não justifica arrastar um gerador de PDF.
  function printDocument(doc: GeneratedDocument) {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    w.document.write(
      `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>` +
        '<style>body{font-family:Georgia,"Times New Roman",serif;font-size:13pt;line-height:1.7;' +
        'white-space:pre-wrap;margin:2.5cm;color:#111}@media print{body{margin:2cm}}</style>' +
        `</head><body>${escapeHtml(doc.body)}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  async function saveTemplate() {
    setBusy(true);
    setError('');
    try {
      if (templateModal === 'new') {
        await api('/document-templates', { method: 'POST', body: templateForm });
      } else if (templateModal) {
        await api(`/document-templates/${templateModal.id}`, { method: 'PUT', body: templateForm });
      }
      setTemplateModal(null);
      setTemplateForm(EMPTY_TEMPLATE);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gravar o modelo.');
    } finally {
      setBusy(false);
    }
  }

  async function addPreset() {
    setBusy(true);
    setError('');
    try {
      await api('/document-templates', { method: 'POST', body: { preset: true } });
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao adicionar os modelos.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(t: DocumentTemplate) {
    setBusy(true);
    await api(`/document-templates/${t.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    loadTemplates();
  }

  if (loading) return <Spinner />;

  const tabs = [
    { key: 'issue', label: 'Emitir' },
    { key: 'issued', label: `Emitidos (${documents.length})` },
    ...(canManageTemplates ? [{ key: 'templates', label: 'Modelos' }] : []),
  ];

  return (
    <div>
      <PageHeader title="Documentos" sub="Declarações, justificações e cartas administrativas — sem conteúdo clínico" />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {error && <AlertBanner type="danger">{error}</AlertBanner>}

      {tab === 'issue' && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 16 }}>
          <PatientsSidebarList
            patients={visiblePatients}
            selectedId={selected?.id}
            onSelect={setSelected}
            loading={false}
            search={search}
            onSearchChange={setSearch}
            emptyMessage="Sem doentes."
          />

          <div className="card p-5">
            {!selected ? (
              <Empty message="Escolhe um doente para emitir um documento." />
            ) : !templates.length ? (
              <Empty message="Ainda não há modelos. Cria um no separador Modelos." />
            ) : (
              <>
                <div className="section-label mb-3">EMITIR PARA {selected.name?.toUpperCase()}</div>

                <FormField label="Modelo">
                  <Sel value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {TYPE_LABEL[t.type]} · {t.name}
                      </option>
                    ))}
                  </Sel>
                </FormField>

                <FormField
                  label="Consulta referida (opcional)"
                  hint="Preenche as variáveis de consulta. Deixa vazio para uma declaração sem consulta associada."
                >
                  <Sel value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
                    <option value="">Sem consulta associada</option>
                    {appointments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {String(a.appt_date).slice(0, 10)} · {String(a.start_time).slice(0, 5)} · {a.type}
                      </option>
                    ))}
                  </Sel>
                </FormField>

                {activeTemplate && (
                  <div
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-control)',
                      padding: 12,
                      marginBottom: 14,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      color: 'var(--text-secondary)',
                      maxHeight: 260,
                      overflowY: 'auto',
                    }}
                  >
                    {activeTemplate.body}
                  </div>
                )}

                <PrimaryBtn onClick={issue} disabled={busy || !templateId}>
                  {busy ? 'A emitir…' : 'Emitir documento'}
                </PrimaryBtn>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'issued' && (
        <div style={{ marginTop: 16 }}>
          {!documents.length ? (
            <Empty message="Ainda não foi emitido nenhum documento." />
          ) : (
            <DataTable
              cols={['Título', 'Doente', 'Tipo', 'Emitido por', 'Data', '']}
              rows={documents.map((d) => (
                <tr key={d.id}>
                  <TD bold>{d.title}</TD>
                  <TD>{d.patient_name}</TD>
                  <TD>
                    <Badge label={TYPE_LABEL[d.type]} />
                  </TD>
                  <TD>{d.issued_by_name || '—'}</TD>
                  <TD>{new Date(d.created_at).toLocaleDateString('pt-PT')}</TD>
                  <TD right>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <GhostBtn
                        onClick={() => {
                          setMissing([]);
                          setPreview(d);
                        }}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        Ver
                      </GhostBtn>
                      <GhostBtn onClick={() => printDocument(d)} style={{ padding: '5px 10px', fontSize: 12 }}>
                        Imprimir
                      </GhostBtn>
                    </div>
                  </TD>
                </tr>
              ))}
            />
          )}
        </div>
      )}

      {tab === 'templates' && canManageTemplates && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <PrimaryBtn
              onClick={() => {
                setTemplateForm(EMPTY_TEMPLATE);
                setTemplateModal('new');
              }}
            >
              + Novo modelo
            </PrimaryBtn>
            <GhostBtn onClick={addPreset} disabled={busy}>
              Adicionar modelos PT
            </GhostBtn>
          </div>

          {!templates.length ? (
            <Empty message="Sem modelos. Usa 'Adicionar modelos PT' para começar." />
          ) : (
            <DataTable
              cols={['Nome', 'Tipo', 'Assunto', '']}
              rows={templates.map((t) => (
                <tr key={t.id}>
                  <TD bold>{t.name}</TD>
                  <TD>
                    <Badge label={TYPE_LABEL[t.type]} />
                  </TD>
                  <TD>{t.subject}</TD>
                  <TD right>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <GhostBtn
                        onClick={() => {
                          setTemplateForm({ name: t.name, type: t.type, subject: t.subject, body: t.body });
                          setTemplateModal(t);
                        }}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        Editar
                      </GhostBtn>
                      <DangerBtn
                        onClick={() => deactivate(t)}
                        disabled={busy}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        Desativar
                      </DangerBtn>
                    </div>
                  </TD>
                </tr>
              ))}
            />
          )}
        </div>
      )}

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} width={760}>
          {missing.length > 0 && (
            <AlertBanner type="warning">
              Campos sem valor, impressos como espaço para preencher à mão:{' '}
              {missing.map((k) => variables.find((v) => v.key === k)?.label || k).join(', ')}
            </AlertBanner>
          )}
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-control)',
              padding: 20,
              whiteSpace: 'pre-wrap',
              fontFamily: 'Georgia, serif',
              fontSize: 13,
              lineHeight: 1.7,
              maxHeight: '55vh',
              overflowY: 'auto',
            }}
          >
            {preview.body}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <GhostBtn onClick={() => setPreview(null)}>Fechar</GhostBtn>
            <PrimaryBtn onClick={() => printDocument(preview)}>Imprimir</PrimaryBtn>
          </div>
        </Modal>
      )}

      {templateModal && (
        <Modal
          title={templateModal === 'new' ? 'Novo modelo' : `Editar: ${templateModal.name}`}
          onClose={() => setTemplateModal(null)}
          width={760}
        >
          <FormField label="Nome">
            <Inp
              value={templateForm.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <FormField label="Tipo">
            <Sel
              value={templateForm.type}
              onChange={(e) => setTemplateForm((f) => ({ ...f, type: e.target.value as DocumentTemplateType }))}
            >
              {Object.entries(TYPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Assunto/título">
            <Inp
              value={templateForm.subject}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setTemplateForm((f) => ({ ...f, subject: e.target.value }))
              }
            />
          </FormField>
          <FormField label="Corpo" hint="Usa os marcadores abaixo. Um marcador desconhecido é recusado ao gravar.">
            <Textarea
              value={templateForm.body}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setTemplateForm((f) => ({ ...f, body: e.target.value }))
              }
              style={{ minHeight: 240, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </FormField>
          <div className="section-label mb-2">MARCADORES DISPONÍVEIS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {variables.map((v) => (
              <button
                type="button"
                key={v.key}
                title={v.label}
                onClick={() => setTemplateForm((f) => ({ ...f, body: `${f.body}{{${v.key}}}` }))}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-control)',
                  padding: '3px 8px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, monospace',
                  background: 'var(--bg-sunken)',
                  cursor: 'pointer',
                }}
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setTemplateModal(null)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={saveTemplate} disabled={busy || !templateForm.name || !templateForm.body}>
              {busy ? 'A gravar…' : 'Gravar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
