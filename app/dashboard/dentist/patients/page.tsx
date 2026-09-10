'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import PatientNotesTab from '@/components/dentist/PatientNotesTab';
import PatientTreatmentsTab from '@/components/dentist/PatientTreatmentsTab';
import CommPrefsCard from '@/components/patient/CommPrefsCard';
import NextActionBanner from '@/components/patient/NextActionBanner';
import PatientDocumentsTab from '@/components/patient/PatientDocumentsTab';
import PatientInteractionsTab from '@/components/patient/PatientInteractionsTab';
import PatientTasksTab from '@/components/patient/PatientTasksTab';
import SchedulingPrefsCard from '@/components/patient/SchedulingPrefsCard';
import PatientDetailHeader from '@/components/shared/PatientDetailHeader';
import PatientOverviewTab from '@/components/shared/PatientOverviewTab';
import PatientsSidebarList from '@/components/shared/PatientsSidebarList';
import type { SchemaField } from '@/components/shared/SchemaFieldInput';
import { Empty, PageHeader, Tabs, Timeline } from '@/components/ui';
import type { MissingField } from '@/lib/missingData';
import type { NextAction } from '@/lib/nextAction';
import type { Patient, PatientInteraction, PatientTask, TimelineEvent, Treatment } from '@/lib/types';

interface UploadRow {
  id: string;
  url: string;
  category: string;
  content_type: string | null;
  size: number;
  created_at: string;
  task_id: string | null;
}

export default function DentistPatientsPage() {
  const { api, user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [notes, setNotes] = useState<TimelineEvent[]>([]);
  const [tasks, setTasks] = useState<PatientTask[]>([]);
  const [interactions, setInteractions] = useState<PatientInteraction[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [nextAction, setNextAction] = useState<NextAction | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);

  const select = useCallback(
    async (p: Patient) => {
      setSelected(p);
      setTab('overview');
      const [tl, tr, n, tk, ia, up, na] = await Promise.all([
        api(`/patients/${p.id}/timeline`).catch(() => []),
        api(`/treatments?patientId=${p.id}`).catch(() => []),
        api(`/notes?patientId=${p.id}`).catch(() => []),
        api(`/patient-tasks?patientId=${p.id}`).catch(() => []),
        api(`/patient-interactions?patientId=${p.id}`).catch(() => []),
        api(`/uploads?patientId=${p.id}`).catch(() => []),
        api(`/patients/${p.id}/next-action`).catch(() => null),
      ]);
      setTimeline(tl || []);
      setTreatments(tr || []);
      setNotes(n || []);
      setTasks(tk || []);
      setInteractions(ia || []);
      setUploads(up || []);
      setNextAction(na?.nextAction || null);
      setMissingFields(na?.missingFields || []);
    },
    [api],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const d = await api(`/patients?q=${encodeURIComponent(search)}`).catch(() => []);
    setPatients(d || []);
    if (!selected && d?.length) select(d[0]);
    setLoading(false);
  }, [api, search, selected, select]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api('/schema')
      .then((d) => setSchemaFields((d || []).filter((f: SchemaField) => Number(f.rollout || 0) === 100)))
      .catch(() => {});
  }, [api]);

  async function refreshTimeline() {
    if (!selected) return;
    const tl = await api(`/patients/${selected.id}/timeline`).catch(() => null);
    if (tl) setTimeline(tl || []);
  }

  const openTaskCount = tasks.filter((t) => t.status === 'pending').length;
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'treatments', label: `Treatments (${treatments.length})` },
    { key: 'notes', label: `Notes (${notes.length})` },
    { key: 'tasks', label: `Tarefas (${openTaskCount})` },
    { key: 'interactions', label: `Interações (${interactions.length})` },
    { key: 'documents', label: `Documentos (${uploads.length})` },
    { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div>
      <PageHeader title="Doentes" sub="Registos clínicos — historial completo" />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <PatientsSidebarList
          patients={patients}
          selectedId={selected?.id}
          onSelect={select}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          alwaysShowRiskBadge
          emptyMessage="No patients"
        />

        {selected ? (
          <div>
            <PatientDetailHeader patient={selected} avatarSize={50} balanceLabel="Balance" showVisitCount />

            <NextActionBanner nextAction={nextAction} missingFields={missingFields} />

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'overview' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <PatientOverviewTab
                  fields={[
                    ['Phone', selected.phone || '—'],
                    ['Email', selected.email || '—'],
                    ['Last Visit', selected.last_visit?.slice(0, 10) || '—'],
                    ['Insurance', selected.insurance || '—'],
                    ['DOB', selected.dob?.slice(0, 10) || '—'],
                    ['No-Show Count', `${selected.no_show_count || 0} of ${selected.visit_count || 0}`],
                  ]}
                  customFields={selected.custom_fields}
                  schemaFields={schemaFields}
                />
                <CommPrefsCard api={api} patient={selected} onUpdated={setSelected} />
                <SchedulingPrefsCard api={api} patient={selected} />
              </div>
            )}

            {tab === 'treatments' && <PatientTreatmentsTab treatments={treatments} />}

            {tab === 'timeline' && (
              <div className="card p-5">
                <div className="section-label mb-4">MASTER PATIENT TIMELINE — IMMUTABLE · SHA-256 HASHED</div>
                <Timeline events={timeline} />
              </div>
            )}

            {tab === 'notes' && (
              <PatientNotesTab
                api={api}
                user={user}
                patientId={selected.id}
                notes={notes}
                setNotes={setNotes}
                refreshTimeline={refreshTimeline}
              />
            )}

            {tab === 'tasks' && (
              <PatientTasksTab api={api} user={user} patientId={selected.id} tasks={tasks} setTasks={setTasks} />
            )}

            {tab === 'interactions' && (
              <PatientInteractionsTab
                api={api}
                patientId={selected.id}
                interactions={interactions}
                setInteractions={setInteractions}
              />
            )}

            {tab === 'documents' && (
              <PatientDocumentsTab
                api={api}
                patientId={selected.id}
                tasks={tasks}
                setTasks={setTasks}
                uploads={uploads}
                setUploads={setUploads}
              />
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view their clinical record" />
        )}
      </div>
    </div>
  );
}
