'use client';
import CommsSettings from '@/components/clinic/pages/CommsSettings';
import DataSubjectRequests from '@/components/clinic/pages/DataSubjectRequests';
import LeadSources from '@/components/clinic/pages/LeadSources';
import AuditLog from '@/components/shared/AuditLog';
import PermissionsMatrix from '@/components/shared/PermissionsMatrix';
import SchemaFields from '@/components/shared/SchemaFields';
import UsersAndAccess from '@/components/shared/UsersAndAccess';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// ─── A gaveta que ocupava um terço do menu ──────────────────────────────────
// O grupo DEFINIÇÕES do admin tinha sete entradas: Utilizadores, Permissões, Campos
// Schema, Fontes de Leads, Canais e Autonomia, Proteção de Dados e Auditoria. Sete de
// vinte e quatro — quase um terço da barra lateral — e nenhuma delas se abre durante o
// dia de trabalho. Configura-se uma vez, revê-se de vez em quando.
//
// Estavam no menu pelo mesmo motivo que quase tudo o resto estava: o menu tinha crescido
// como espelho da árvore de rotas, e cada rota reclamava a sua linha. Mas ninguém vem ao
// menu «procurar os campos de schema»; vem «às definições», e procura lá dentro.
//
// A ordem é a da frequência com que se lhes mexe: as pessoas e o que elas podem fazer
// primeiro, a configuração do que entra a seguir, e no fim o que só se lê (a auditoria,
// que não se configura de todo — está aqui porque é onde se vem confirmar que uma
// definição mudou, e quem a mudou).
const TABS = [
  { key: 'utilizadores', label: 'Utilizadores' },
  { key: 'permissoes', label: 'Permissões' },
  { key: 'campos', label: 'Campos de registo' },
  { key: 'leads', label: 'Fontes de leads' },
  { key: 'canais', label: 'Canais e autonomia' },
  { key: 'dados', label: 'Proteção de dados' },
  { key: 'auditoria', label: 'Auditoria' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Definicoes() {
  const [tab, setTab] = useTabHash(CHAVES, 'utilizadores');

  return (
    <div>
      <PageHeader
        title="Definições"
        sub="Quem entra, o que pode fazer, o que a clínica recolhe e o que ficou registado"
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'utilizadores' && <UsersAndAccess />}
      {tab === 'permissoes' && <PermissionsMatrix />}
      {tab === 'campos' && <SchemaFields />}
      {tab === 'leads' && <LeadSources />}
      {tab === 'canais' && <CommsSettings />}
      {tab === 'dados' && <DataSubjectRequests />}
      {tab === 'auditoria' && <AuditLog scope="clinic" />}
    </div>
  );
}
