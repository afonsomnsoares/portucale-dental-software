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
import { useQuery } from '@/hooks/useQuery';
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
  const [selected, setSelected] = useState<Patient | null>(null);
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');

  // ─── O espaço de um doente, declarado em vez de orquestrado ───────────────
  // Isto era um `select(p)` que disparava sete pedidos em Promise.all e os
  // distribuía por sete useState. Duas consequências: os sete falhavam para
  // dentro (`.catch(() => [])`), e o separador «Documentos» de um doente ficava
  // a mostrar os do anterior até o novo lote chegar todo.
  //
  // Declarado assim, cada separador tem a sua leitura, e o id do doente
  // escolhido é a única coisa que a comanda. Escolher outro doente invalida
  // tudo de uma vez, sem orquestração nenhuma.
  const patientsQuery = useQuery<Patient[]>(`/patients?q=${encodeURIComponent(search)}`);
  const patients = patientsQuery.data ?? [];

  const pid = selected?.id ?? null;
  const timelineQuery = useQuery<TimelineEvent[]>(pid ? `/patients/${pid}/timeline` : null);
  const treatmentsQuery = useQuery<Treatment[]>(pid ? `/treatments?patientId=${pid}` : null);
  const notesQuery = useQuery<TimelineEvent[]>(pid ? `/notes?patientId=${pid}` : null);
  const tasksQuery = useQuery<PatientTask[]>(pid ? `/patient-tasks?patientId=${pid}` : null);
  const interactionsQuery = useQuery<PatientInteraction[]>(pid ? `/patient-interactions?patientId=${pid}` : null);
  const uploadsQuery = useQuery<UploadRow[]>(pid ? `/uploads?patientId=${pid}` : null);
  const nextActionQuery = useQuery<{ nextAction: NextAction | null; missingFields: MissingField[] }>(
    pid ? `/patients/${pid}/next-action` : null,
  );
  const schemaQuery = useQuery<SchemaField[]>('/schema');

  const timeline = timelineQuery.data ?? [];
  const treatments = treatmentsQuery.data ?? [];
  const notes = notesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const interactions = interactionsQuery.data ?? [];
  const uploads = uploadsQuery.data ?? [];
  const nextAction = nextActionQuery.data?.nextAction ?? null;
  const missingFields = nextActionQuery.data?.missingFields ?? [];
  const schemaFields = (schemaQuery.data ?? []).filter((f) => Number(f.rollout || 0) === 100);

  const select = useCallback((p: Patient) => {
    setSelected(p);
    setTab('overview');
  }, []);

  // O primeiro doente da lista abre sozinho, mas só enquanto ninguém tiver
  // escolhido nada — não se rouba a escolha a quem já a fez.
  useEffect(() => {
    if (!selected && patients.length) select(patients[0]);
  }, [selected, patients, select]);

  const refreshTimeline = timelineQuery.refetch;

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
          loading={patientsQuery.loading}
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
                onChanged={() => {
                  notesQuery.refetch();
                  refreshTimeline();
                }}
              />
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
          <Empty message="Escolhe um doente à esquerda para abrir o espaço dele." />
        )}
      </div>
    </div>
  );
}
