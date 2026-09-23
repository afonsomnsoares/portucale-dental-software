'use client';
import SchemaFields from '@/components/shared/SchemaFields';
import SystemConfig from '@/components/super-admin/pages/SystemConfig';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';
import type { SystemConfigInfo } from '@/lib/types/platform';

// As duas coisas que se configuram ao nível da plataforma: o que o processo tem à frente
// e que campos as fichas de doente têm. Não se parecem uma com a outra, e é precisamente
// por isso que não merecem duas entradas — ninguém vem ao menu «procurar definições de
// schema», vem «às definições».
const TABS = [
  { key: 'sistema', label: 'Sistema' },
  { key: 'campos', label: 'Campos de registo' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Configuracao({ initialConfig }: { initialConfig?: SystemConfigInfo } = {}) {
  const [tab, setTab] = useTabHash(CHAVES, 'sistema');

  return (
    <div>
      <PageHeader title="Configuração" sub="O que este processo tem à frente, e os campos das fichas de doente" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'sistema' && <SystemConfig initialData={initialConfig} />}
      {tab === 'campos' && <SchemaFields />}
    </div>
  );
}
