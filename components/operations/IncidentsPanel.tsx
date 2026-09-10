'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  Badge,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  TD,
  Textarea,
} from '@/components/ui';
import type { DbUser, Incident, IncidentCategory, IncidentSeverity, IncidentStatus } from '@/lib/types';

interface IncidentsPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  canManage: boolean;
  tenantId?: string;
  teamUsers?: DbUser[];
}

const CATEGORY_LABEL: Record<string, string> = {
  equipment: 'Equipamento',
  patient_safety: 'Segurança do paciente',
  complaint: 'Reclamação',
  security: 'Segurança/Instalações',
  other: 'Outro',
};
const SEVERITY_META: Record<string, { label: string; bg: string; color: string }> = {
  low: { label: 'Baixa', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
  medium: { label: 'Média', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  high: { label: 'Alta', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  critical: { label: 'Crítica', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
};
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  open: { label: 'Aberto', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  in_progress: { label: 'Em curso', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  resolved: { label: 'Resolvido', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  closed: { label: 'Fechado', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
};

const EMPTY_FORM = {
  title: '',
  description: '',
  category: 'other' as IncidentCategory,
  severity: 'low' as IncidentSeverity,
};

// Shared between the admin's full management view and the self-service staff view
// (canManage=false hides assignment/resolution controls, everyone can still report and
// see the list — see app/api/incidents/route.ts's GET being open to any tenant member).
export default function IncidentsPanel({ api, canManage, tenantId, teamUsers = [] }: IncidentsPanelProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [reportModal, setReportModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Incident | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (tenantId) params.set('tenantId', tenantId);
    const qs = params.toString();
    const rows = await api(`/incidents${qs ? `?${qs}` : ''}`).catch(() => []);
    setIncidents(rows || []);
    setLoading(false);
  }, [api, statusFilter, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function reportIncident() {
    if (!form.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api('/incidents', { method: 'POST', body: { ...form, ...(tenantId ? { tenantId } : {}) } });
      setReportModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao reportar incidente.');
    } finally {
      setSaving(false);
    }
  }

  async function assign(incident: Incident, userId: string) {
    setBusyId(incident.id);
    await api(`/incidents/${incident.id}`, {
      method: 'PUT',
      body: { assignedTo: userId || null, status: incident.status === 'open' ? 'in_progress' : incident.status },
    }).catch(() => null);
    setBusyId(null);
    load();
  }

  async function setStatus(incident: Incident, status: IncidentStatus) {
    setBusyId(incident.id);
    await api(`/incidents/${incident.id}`, { method: 'PUT', body: { status } }).catch(() => null);
    setBusyId(null);
    load();
  }

  async function resolve() {
    if (!resolveTarget) return;
    setBusyId(resolveTarget.id);
    await api(`/incidents/${resolveTarget.id}`, {
      method: 'PUT',
      body: { status: 'resolved', resolutionNotes },
    }).catch(() => null);
    setBusyId(null);
    setResolveTarget(null);
    setResolutionNotes('');
    load();
  }

  return (
    <div>
      <PageHeader title="Incidentes" sub="Reportar e seguir incidentes até resolução">
        <PrimaryBtn onClick={() => setReportModal(true)}>+ Reportar incidente</PrimaryBtn>
      </PageHeader>

      <div className="flex items-center gap-3 mb-4">
        <Sel value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">Todos os estados</option>
          <option value="open">Abertos</option>
          <option value="in_progress">Em curso</option>
          <option value="resolved">Resolvidos</option>
          <option value="closed">Fechados</option>
        </Sel>
      </div>

      {loading ? (
        <Spinner />
      ) : !incidents.length ? (
        <Empty message="Sem incidentes." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            cols={['Título', 'Categoria', 'Severidade', 'Reportado por', 'Atribuído a', 'Estado', canManage ? '' : ' ']}
            rows={incidents.map((i) => {
              const sev = SEVERITY_META[i.severity];
              const st = STATUS_META[i.status];
              const open = i.status !== 'resolved' && i.status !== 'closed';
              return (
                <tr key={i.id}>
                  <TD bold>{i.title}</TD>
                  <TD muted>{CATEGORY_LABEL[i.category]}</TD>
                  <TD>
                    <Badge label={sev.label} bg={sev.bg} color={sev.color} />
                  </TD>
                  <TD muted>{i.reported_by_name || '—'}</TD>
                  <TD>
                    {canManage ? (
                      <Sel
                        value={i.assigned_to || ''}
                        onChange={(e) => assign(i, e.target.value)}
                        disabled={busyId === i.id}
                        style={{ fontSize: 12, padding: '3px 6px' }}
                      >
                        <option value="">Ninguém</option>
                        {teamUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Sel>
                    ) : (
                      i.assigned_to_name || '—'
                    )}
                  </TD>
                  <TD>
                    <Badge label={st.label} bg={st.bg} color={st.color} />
                  </TD>
                  <TD right>
                    {canManage && open && (
                      <div className="flex items-center justify-end gap-2">
                        {i.status === 'open' && (
                          <GhostBtn
                            disabled={busyId === i.id}
                            onClick={() => setStatus(i, 'in_progress')}
                            style={{ padding: '5px 10px', fontSize: 12 }}
                          >
                            Em curso
                          </GhostBtn>
                        )}
                        <GhostBtn
                          disabled={busyId === i.id}
                          onClick={() => {
                            setResolveTarget(i);
                            setResolutionNotes('');
                          }}
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Resolver
                        </GhostBtn>
                      </div>
                    )}
                  </TD>
                </tr>
              );
            })}
          />
        </div>
      )}

      {reportModal && (
        <Modal title="Reportar incidente" onClose={() => setReportModal(false)}>
          <FormField label="Título">
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Autoclave avariada"
            />
          </FormField>
          <FormField label="Categoria">
            <Sel
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as IncidentCategory }))}
            >
              {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Severidade">
            <Sel
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as IncidentSeverity }))}
            >
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </Sel>
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              style={{ minHeight: 90 }}
            />
          </FormField>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setReportModal(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={reportIncident} disabled={saving || !form.title.trim()}>
              {saving ? 'A reportar…' : 'Reportar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {resolveTarget && (
        <Modal title={`Resolver — ${resolveTarget.title}`} onClose={() => setResolveTarget(null)}>
          <FormField label="Notas de resolução">
            <Textarea
              value={resolutionNotes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setResolutionNotes(e.target.value)}
              style={{ minHeight: 90 }}
              placeholder="O que foi feito para resolver este incidente?"
            />
          </FormField>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setResolveTarget(null)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={resolve} disabled={busyId === resolveTarget.id}>
              Marcar como resolvido
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
