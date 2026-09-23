'use client';
import { useAuth } from '@/app/providers';
import JornadaPanel from '@/components/reception/JornadaPanel';
import TratamentosPanel from '@/components/reception/TratamentosPanel';
import { clinicaMono, PageChrome, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// Os planos propostos e onde cada doente está no percurso. A «Jornada do Doente» era uma
// entrada à parte, mas ao balcão responde-se sempre à mesma pergunta — «e este, o que é
// que falta?» — e a resposta está metade num sítio e metade no outro.
const TABS = [
  { key: 'planos', label: 'Planos' },
  { key: 'jornada', label: 'Jornada' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Tratamentos() {
  const { user } = useAuth();
  const [tab, setTab] = useTabHash(CHAVES, 'planos');

  return (
    <div>
      <PageChrome
        title="Tratamentos"
        context={clinicaMono(user?.tenantName || user?.clinic)}
        nav={<Tabs tabs={TABS} active={tab} onChange={setTab} compact />}
      />

      {tab === 'planos' && <TratamentosPanel />}
      {tab === 'jornada' && <JornadaPanel />}
    </div>
  );
}
