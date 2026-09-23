'use client';
import Onboarding from '@/components/super-admin/pages/Onboarding';
import Tenants from '@/components/super-admin/pages/Tenants';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// «Clínicas» listava as clínicas; «Onboarding» listava as mesmas clínicas com os passos
// que ainda lhes faltam. A segunda é um estado da primeira, e um estado não é um
// destino: quem abre a lista para ver como vai uma clínica nova não devia ter de saber
// que há uma segunda página onde isso está.
const TABS = [
  { key: 'clinicas', label: 'Clínicas' },
  { key: 'onboarding', label: 'Onboarding' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Clinicas() {
  const [tab, setTab] = useTabHash(CHAVES, 'clinicas');

  return (
    <div>
      <PageHeader title="Clínicas" sub="Criar clínicas, entrar em cada uma, e ver as que ainda não arrancaram" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'clinicas' && <Tenants />}
      {tab === 'onboarding' && <Onboarding />}
    </div>
  );
}
