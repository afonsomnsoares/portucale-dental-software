'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import PatientNotesTab from '@/components/dentist/PatientNotesTab';
import PatientTreatmentsTab from '@/components/dentist/PatientTreatmentsTab';
import PatientDetailHeader from '@/components/shared/PatientDetailHeader';
import PatientOverviewTab from '@/components/shared/PatientOverviewTab';
import PatientsSidebarList from '@/components/shared/PatientsSidebarList';
import type { SchemaField } from '@/components/shared/SchemaFieldInput';
import { Empty, PageHeader, Tabs, Timeline } from '@/components/ui';
import type { Patient, TimelineEvent, Treatment } from '@/lib/types';

export default function DentistPatientsPage() {
  const { api, user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [notes, setNotes] = useState<TimelineEvent[]>([]);
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);

  const select = useCallback(
    async (p: Patient) => {
      setSelected(p);
      setTab('overview');
      const [tl, tr, n] = await Promise.all([
        api(`/patients/${p.id}/timeline`).catch(() => []),
        api(`/treatments?patientId=${p.id}`).catch(() => []),
        api(`/notes?patientId=${p.id}`).catch(() => []),
      ]);
      setTimeline(tl || []);
      setTreatments(tr || []);
      setNotes(n || []);
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

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'treatments', label: `Treatments (${treatments.length})` },
    { key: 'notes', label: `Notes (${notes.length})` },
    { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div>
      <PageHeader title="Patients" sub="Clinical patient records — full history and chart data" />
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

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'overview' && (
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
          </div>
        ) : (
          <Empty message="Select a patient to view their clinical record" />
        )}
      </div>
    </div>
  );
}
