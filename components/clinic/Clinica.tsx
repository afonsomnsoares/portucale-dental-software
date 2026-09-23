'use client';
import { useAuth } from '@/app/providers';
import DocumentsView from '@/components/documents/DocumentsView';
import ChecklistPanel from '@/components/operations/ChecklistPanel';
import IncidentsPanel from '@/components/operations/IncidentsPanel';
import TeamRosterView from '@/components/team/TeamRosterView';
import { clinicaMono, PageChrome, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// ─── As três entradas que não eram filas de trabalho ────────────────────────
// Checklists, Equipa e Documentos eram três entradas no menu do balcão e outras três no
// do dentista. Nenhuma é uma fila: são o sítio onde se vai confirmar uma coisa quando
// ela é precisa — quem está de serviço hoje, o que falta fechar, onde está o impresso.
//
// Um componente e não dois: as páginas de operações dos dois papéis eram ficheiros
// byte a byte iguais, com nomes diferentes. A terceira alteração tê-los-ia feito
// divergir sem ninguém dar por isso.
const TABS = [
  { key: 'checklists', label: 'Checklists' },
  { key: 'equipa', label: 'Equipa' },
  { key: 'documentos', label: 'Documentos' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Clinica() {
  const { api, user } = useAuth();
  const [tab, setTab] = useTabHash(CHAVES, 'checklists');

  return (
    <div>
      <PageChrome
        title="Clínica"
        context={clinicaMono(user?.tenantName || user?.clinic)}
        nav={<Tabs tabs={TABS} active={tab} onChange={setTab} compact />}
      />

      {tab === 'checklists' && (
        <div>
          <div className="section-label mb-3">CHECKLISTS DE HOJE</div>
          <div className="mb-6">
            <ChecklistPanel api={api} />
          </div>
          <IncidentsPanel api={api} canManage={false} />
        </div>
      )}
      {tab === 'equipa' && <TeamRosterView api={api} currentUserId={user?.id} />}
      {tab === 'documentos' && <DocumentsView api={api} />}
    </div>
  );
}
