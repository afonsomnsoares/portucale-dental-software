'use client';
import UsersAndAccess from '@/components/shared/UsersAndAccess';
import Roles from '@/components/super-admin/pages/Roles';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// Quem existe, e o que cada papel pode. Eram duas entradas de menu e são a mesma
// pergunta vista dos dois lados — da pessoa para a permissão, e da permissão para as
// pessoas. Quem vai a uma vai à outra a seguir.
const TABS = [
  { key: 'pessoas', label: 'Pessoas' },
  { key: 'papeis', label: 'Papéis' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Utilizadores() {
  const [tab, setTab] = useTabHash(CHAVES, 'pessoas');

  return (
    <div>
      <PageHeader title="Utilizadores" sub="Contas de toda a rede, e o que cada papel pode fazer" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'pessoas' && <UsersAndAccess />}
      {tab === 'papeis' && <Roles />}
    </div>
  );
}
