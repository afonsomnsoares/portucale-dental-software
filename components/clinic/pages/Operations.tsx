'use client';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import ChecklistPanel from '@/components/operations/ChecklistPanel';
import IncidentsPanel from '@/components/operations/IncidentsPanel';
import TemplateManager from '@/components/operations/TemplateManager';
import { ErrorState, PageHeader, Spinner, Tabs } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { DbUser } from '@/lib/types';

// Operações da própria clínica. A versão de plataforma
// (components/super-admin/pages/Operations.tsx) escolhe a clínica primeiro e filtra a equipa
// do lado do cliente; aqui não é preciso nenhuma das duas coisas — os painéis sem
// tenantId caem no tenant de quem chama, e /api/users já só devolve a equipa desta
// clínica (ver o filtro por user.tenantId em app/api/users/route.ts).
export default function ClinicOperationsPage() {
  const { api } = useAuth();
  const [tab, setTab] = useState('checklists');
  // A equipa serve para atribuir tarefas e turnos. Falhar em silêncio dava um
  // seletor vazio — e um seletor vazio lê-se como «não há ninguém na clínica».
  //
  // Isto esteve escrito aqui durante todo este tempo com um `?? []` por baixo, que é
  // exatamente o falhar em silêncio que o comentário descrevia. O `useQuery` devolve
  // `error` de propósito: sem o ler, um 500 em /api/users e uma clínica sem pessoal
  // dão o mesmo ecrã.
  const teamQuery = useQuery<DbUser[]>('/users');
  const teamUsers = teamQuery.data ?? [];

  return (
    <div>
      <PageHeader title="Operações da Clínica" sub="Checklists de abertura/fecho e escalamento de incidentes" />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'checklists', label: 'Checklists' },
          { key: 'incidents', label: 'Incidentes' },
        ]}
      />

      {tab === 'checklists' ? (
        <div>
          <div className="card p-5 mb-5">
            <TemplateManager api={api} />
          </div>
          <div className="section-label mb-3">CHECKLISTS DE HOJE</div>
          <ChecklistPanel api={api} />
        </div>
      ) : teamQuery.error ? (
        <ErrorState
          error={teamQuery.error}
          onRetry={teamQuery.refetch}
          message="Não foi possível carregar a equipa da clínica."
        />
      ) : teamQuery.loading ? (
        <Spinner />
      ) : (
        <IncidentsPanel api={api} canManage teamUsers={teamUsers} />
      )}
    </div>
  );
}
