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
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect';
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

// ─── A síntese ──────────────────────────────────────────────────────────────
// Quatro números que respondem, de relance, ao que o clínico precisa de saber antes de
// falar com a pessoa. Não são métricas de gestão — são o estado do caso.
//
// «Em curso» conta os tratamentos aceites e por concluir, que é a definição de
// "tratamento a meio" que lib/patientScoring.ts também usa para o risco de abandono. Um
// número que aparece em dois sítios com duas definições diferentes é pior do que não
// aparecer.
function Sintese({
  treatments,
  tasks,
  uploads,
  nextAction,
}: {
  treatments: Treatment[];
  tasks: PatientTask[];
  uploads: UploadRow[];
  nextAction: NextAction | null;
}) {
  const emCurso = treatments.filter((t) => t.status === 'accepted').length;
  const propostos = treatments.filter((t) => t.status === 'proposed').length;
  const concluidos = treatments.filter((t) => t.status === 'completed').length;
  const porFazer = tasks.filter((t) => t.status !== 'done').length;

  const celulas: Array<{ n: number; t: string; cor?: string }> = [
    {
      n: emCurso,
      t: emCurso === 1 ? 'tratamento em curso' : 'tratamentos em curso',
      cor: emCurso ? 'var(--accent)' : undefined,
    },
    {
      n: propostos,
      t: propostos === 1 ? 'plano por decidir' : 'planos por decidir',
      cor: propostos ? 'var(--urgency-soon)' : undefined,
    },
    { n: concluidos, t: concluidos === 1 ? 'tratamento concluído' : 'tratamentos concluídos' },
    {
      n: porFazer,
      t: porFazer === 1 ? 'tarefa por fazer' : 'tarefas por fazer',
      cor: porFazer ? 'var(--urgency-soon)' : undefined,
    },
    { n: uploads.length, t: uploads.length === 1 ? 'documento' : 'documentos' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 26,
        padding: '12px 16px',
        marginBottom: 14,
        background: 'var(--bg-sunken)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      {celulas.map((c) => (
        <div key={c.t}>
          <div
            style={{
              fontSize: 19,
              fontWeight: 700,
              lineHeight: 1.1,
              color: c.cor || 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {c.n}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.t}</div>
        </div>
      ))}
      {nextAction && nextAction.code === 'UP_TO_DATE' && (
        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--urgency-ok)' }}>
          Nada pendente deste lado.
        </div>
      )}
    </div>
  );
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
  useDebouncedEffect(() => {
    load();
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
    { key: 'overview', label: 'Visão Geral' },
    { key: 'treatments', label: `Tratamentos (${treatments.length})` },
    { key: 'notes', label: `Notas (${notes.length})` },
    { key: 'tasks', label: `Tarefas (${openTaskCount})` },
    { key: 'interactions', label: `Interações (${interactions.length})` },
    { key: 'documents', label: `Documentos (${uploads.length})` },
    { key: 'timeline', label: 'Cronologia' },
  ];

  return (
    <div>
      <PageHeader
        title="Espaço do Doente"
        sub="Abre-se a pessoa e o resto são separadores — quem é, o que tem, o que estamos a tratar, o que falta."
      />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <PatientsSidebarList
          patients={patients}
          selectedId={selected?.id}
          onSelect={select}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          alwaysShowRiskBadge
          emptyMessage="Sem doentes"
        />

        {selected ? (
          <div>
            <PatientDetailHeader patient={selected} avatarSize={50} balanceLabel="Saldo" showVisitCount />

            {/* ── A síntese, antes dos separadores ────────────────────────────
                As seis perguntas que o clínico faz nos primeiros segundos: o que
                estamos a tratar, o que já fizemos, o que falta, e o que vem a seguir.
                Estavam todas espalhadas por separadores diferentes — e responder a
                elas exigia abrir quatro. */}
            <Sintese treatments={treatments} tasks={tasks} uploads={uploads} nextAction={nextAction} />

            <NextActionBanner nextAction={nextAction} missingFields={missingFields} />

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'overview' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <PatientOverviewTab
                  fields={[
                    ['Telefone', selected.phone || '—'],
                    ['E-mail', selected.email || '—'],
                    ['Última visita', selected.last_visit?.slice(0, 10) || '—'],
                    ['Seguro', selected.insurance || '—'],
                    ['Data de nascimento', selected.dob?.slice(0, 10) || '—'],
                    ['Faltas', `${selected.no_show_count || 0} em ${selected.visit_count || 0} consultas`],
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
                <div className="section-label mb-4">CRONOLOGIA DO DOENTE — IMUTÁVEL · COM RESUMO SHA-256</div>
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
          <Empty message="Escolhe um doente à esquerda para abrir o espaço dele." />
        )}
      </div>
    </div>
  );
}
