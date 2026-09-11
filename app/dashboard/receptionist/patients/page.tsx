'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import CommPrefsCard from '@/components/patient/CommPrefsCard';
import NextActionBanner from '@/components/patient/NextActionBanner';
import PatientDocumentsTab from '@/components/patient/PatientDocumentsTab';
import PatientInteractionsTab from '@/components/patient/PatientInteractionsTab';
import PatientTasksTab from '@/components/patient/PatientTasksTab';
import SchedulingPrefsCard from '@/components/patient/SchedulingPrefsCard';
import PatientCreateModal, { type NewPatientForm } from '@/components/receptionist/PatientCreateModal';
import PatientEditExtraFieldsModal from '@/components/receptionist/PatientEditExtraFieldsModal';
import PatientImportCsvModal from '@/components/receptionist/PatientImportCsvModal';
import PatientDetailHeader from '@/components/shared/PatientDetailHeader';
import PatientOverviewTab from '@/components/shared/PatientOverviewTab';
import PatientsSidebarList from '@/components/shared/PatientsSidebarList';
import type { SchemaField } from '@/components/shared/SchemaFieldInput';
import { Empty, GhostBtn, PageHeader, Spinner, Tabs, Timeline } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { MissingField } from '@/lib/missingData';
import type { NextAction } from '@/lib/nextAction';
import type { Patient, PatientInteraction, PatientTask, TimelineEvent } from '@/lib/types';

interface UploadRow {
  id: string;
  url: string;
  category: string;
  content_type: string | null;
  size: number;
  created_at: string;
  task_id: string | null;
}

const EMPTY_NEW_PATIENT: NewPatientForm = { name: '', dob: '', phone: '', email: '', insurance: '', alerts: '' };

export default function ReceptionPatientsPage() {
  const { api, user } = useAuth();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [tab, setTab] = useState('profile');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewPatientForm>(EMPTY_NEW_PATIENT);
  const [saving, setSaving] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [editExtra, setEditExtra] = useState(false);
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraForm, setExtraForm] = useState<Record<string, unknown>>({});
  const [importOpen, setImportOpen] = useState(false);

  // Mesmo desenho da página equivalente do dentista: o id do doente escolhido
  // comanda as leituras, em vez de um `select()` a orquestrar cinco pedidos.
  const patientsQuery = useQuery<Patient[]>(`/patients?q=${encodeURIComponent(search)}`);
  const patients = patientsQuery.data ?? [];

  const pid = selected?.id ?? null;
  const timelineQuery = useQuery<TimelineEvent[]>(pid ? `/patients/${pid}/timeline` : null);
  const tasksQuery = useQuery<PatientTask[]>(pid ? `/patient-tasks?patientId=${pid}` : null);
  const interactionsQuery = useQuery<PatientInteraction[]>(pid ? `/patient-interactions?patientId=${pid}` : null);
  const uploadsQuery = useQuery<UploadRow[]>(pid ? `/uploads?patientId=${pid}` : null);
  const nextActionQuery = useQuery<{ nextAction: NextAction | null; missingFields: MissingField[] }>(
    pid ? `/patients/${pid}/next-action` : null,
  );
  const schemaQuery = useQuery<SchemaField[]>('/schema');

  const timeline = timelineQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const interactions = interactionsQuery.data ?? [];
  const uploads = uploadsQuery.data ?? [];
  const nextAction = nextActionQuery.data?.nextAction ?? null;
  const missingFields = nextActionQuery.data?.missingFields ?? [];
  const schemaFields = (schemaQuery.data ?? []).filter((f) => Number(f.rollout || 0) === 100);

  const select = useCallback((p: Patient) => {
    setSelected(p);
    setTab('profile');
  }, []);

  useEffect(() => {
    if (!selected && patients.length) select(patients[0]);
  }, [selected, patients, select]);

  const loadPts = patientsQuery.refetch;
  const loadSchemaFields = schemaQuery.refetch;

  async function create() {
    setCreateErr('');
    const required = (schemaFields || []).filter((f) => !!f.required);
    const payloadCustom: Record<string, unknown> = { ...(customFields || {}) };
    const missing: string[] = [];

    for (const f of required) {
      const key = f.field_name;
      const t = String(f.field_type || 'string');
      const v = payloadCustom[key];
      if (v === undefined || v === null || v === '') {
        if (t === 'boolean') payloadCustom[key] = false;
        else missing.push(f.label || f.field_name);
      }
    }

    if (!form.name?.trim()) {
      setCreateErr('O nome do doente é obrigatório.');
      return;
    }
    if (missing.length) {
      setCreateErr(`Preencha os campos obrigatórios: ${missing.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      const alerts = form.alerts
        ? form.alerts
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : [];
      const p = await api('/patients', { method: 'POST', body: { ...form, alerts, customFields: payloadCustom } });
      loadPts();
      setModal(false);
      setForm(EMPTY_NEW_PATIENT);
      setCustomFields({});
      select(p);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Falha ao registar o doente.');
    } finally {
      setSaving(false);
    }
  }

  function openEditExtra() {
    const current = selected?.custom_fields && typeof selected.custom_fields === 'object' ? selected.custom_fields : {};
    setExtraForm({ ...current });
    setEditExtra(true);
  }

  async function saveExtra() {
    if (!selected) return;
    setExtraSaving(true);
    setCreateErr('');
    try {
      const updated = await api(`/patients/${selected.id}`, {
        method: 'PUT',
        body: { ...selected, customFields: extraForm },
      });
      setSelected(updated);
      loadPts();
      setEditExtra(false);
    } catch (e) {
      // Gravar campos adicionais falhava sem dizer nada: o modal ficava aberto
      // e o botão desprendia-se, como se nada tivesse sido pedido.
      setCreateErr(e instanceof Error ? e.message : 'Não foi possível guardar os campos adicionais.');
    }
    setExtraSaving(false);
  }

  const openTaskCount = tasks.filter((t) => t.status === 'pending').length;
  const TABS = [
    { key: 'profile', label: 'Perfil' },
    { key: 'tasks', label: `Tarefas (${openTaskCount})` },
    { key: 'interactions', label: `Interações (${interactions.length})` },
    { key: 'documents', label: `Documentos (${uploads.length})` },
    { key: 'timeline', label: 'Linha do tempo' },
  ];

  return (
    <div>
      <PageHeader
        title="Registo de doentes"
        sub="Registo global — procurar e gerir doentes de todas as clínicas"
        action="+ Registar doente"
        onAction={() => setModal(true)}
      >
        <GhostBtn onClick={() => setImportOpen(true)} style={{ padding: '8px 12px' }}>
          Importar CSV
        </GhostBtn>
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <PatientsSidebarList
          patients={patients}
          selectedId={selected?.id}
          onSelect={select}
          loading={patientsQuery.loading}
          search={search}
          onSearchChange={setSearch}
        />

        {selected ? (
          <div>
            <PatientDetailHeader patient={selected} />

            <NextActionBanner nextAction={nextAction} missingFields={missingFields} />

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'profile' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <PatientOverviewTab
                  fields={[
                    ['Telefone', selected.phone || '—'],
                    ['Email', selected.email || '—'],
                    ['Última visita', selected.last_visit?.slice(0, 10) || '—'],
                    ['Seguro', selected.insurance || '—'],
                    ['Data de nasc.', selected.dob?.slice(0, 10) || '—'],
                    ['Total de visitas', selected.visit_count || 0],
                  ]}
                  customFields={selected.custom_fields}
                  schemaFields={schemaFields}
                  onEditExtra={openEditExtra}
                />
                <CommPrefsCard api={api} patient={selected} onUpdated={setSelected} />
                <SchedulingPrefsCard api={api} patient={selected} />
              </div>
            )}

            {tab === 'timeline' && (
              <div className="card p-5">
                <div className="section-label mb-4">LINHA DO TEMPO DO DOENTE — IMUTÁVEL · HASH SHA-256</div>
                {timelineQuery.loading ? <Spinner /> : <Timeline events={timeline} />}
              </div>
            )}

            {tab === 'tasks' && (
              <PatientTasksTab
                api={api}
                user={user}
                patientId={selected.id}
                tasks={tasks}
                onChanged={tasksQuery.refetch}
              />
            )}

            {tab === 'interactions' && (
              <PatientInteractionsTab
                api={api}
                patientId={selected.id}
                interactions={interactions}
                onChanged={interactionsQuery.refetch}
              />
            )}

            {tab === 'documents' && (
              <PatientDocumentsTab
                api={api}
                patientId={selected.id}
                tasks={tasks}
                uploads={uploads}
                onChanged={() => {
                  tasksQuery.refetch();
                  uploadsQuery.refetch();
                }}
              />
            )}
          </div>
        ) : (
          <Empty message="Selecione um doente para ver o registo" />
        )}
      </div>

      {modal && (
        <PatientCreateModal
          form={form}
          onChange={setForm}
          customFields={customFields}
          onCustomFieldsChange={setCustomFields}
          schemaFields={schemaFields}
          error={createErr}
          saving={saving}
          onSave={create}
          onClose={() => setModal(false)}
        />
      )}

      {editExtra && (
        <PatientEditExtraFieldsModal
          schemaFields={schemaFields}
          extraForm={extraForm}
          onChange={setExtraForm}
          saving={extraSaving}
          onSave={saveExtra}
          onClose={() => setEditExtra(false)}
        />
      )}

      {importOpen && (
        <PatientImportCsvModal
          api={api}
          onImported={() => {
            loadSchemaFields();
            loadPts();
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
