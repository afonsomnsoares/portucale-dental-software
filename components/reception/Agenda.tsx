'use client';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import Cancellations from '@/components/clinic/pages/Cancellations';
import AgendaIntelPanel from '@/components/reception/AgendaIntelPanel';
import ConsultasPanel from '@/components/reception/ConsultasPanel';
import MesPanel from '@/components/reception/MesPanel';
import { clinicaMono, PageChrome, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// A agenda do balcão, nos estados em que se lhe mexe: a forma do mês, o que está
// marcado, o que caiu, e o que a análise diz para fazer com os buracos. Eram três
// entradas de menu em dois grupos diferentes (HOJE e MARCAÇÕES), e ninguém abre os
// cancelamentos sem ser para voltar à agenda a seguir.
//
// ─── Mês e lista são UMA vista, não duas ────────────────────────────────────
// O que as liga é o intervalo de datas, e é por isso que ele vive aqui em cima em
// vez de dentro da lista: carregar num dia do mês põe a lista nesse dia e salta
// para ela. Sem essa ligação seriam dois calendários sobre os mesmos dados — que
// é precisamente o erro que um seletor de vistas existe para não cometer.
const TABS = [
  { key: 'mes', label: 'Mês' },
  { key: 'marcadas', label: 'Marcadas' },
  { key: 'cancelamentos', label: 'Cancelamentos' },
  { key: 'inteligente', label: 'Agenda Inteligente' },
];

const CHAVES = TABS.map((t) => t.key);

function maisDias(dataISO: string, dias: number) {
  const d = new Date(`${dataISO}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}

export default function Agenda() {
  const { user } = useAuth();
  const hoje = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(hoje);
  const [to, setTo] = useState(() => maisDias(hoje, 30));
  const [tab, setTab] = useTabHash(CHAVES, 'marcadas');

  return (
    <div>
      <PageChrome
        title="Agenda"
        context={clinicaMono(user?.tenantName || user?.clinic)}
        nav={<Tabs tabs={TABS} active={tab} onChange={setTab} compact />}
      />

      {tab === 'mes' && (
        <MesPanel
          onPickDay={(dia) => {
            setFrom(dia);
            setTo(dia);
            setTab('marcadas');
          }}
        />
      )}
      {tab === 'marcadas' && <ConsultasPanel from={from} to={to} onFrom={setFrom} onTo={setTo} />}
      {tab === 'cancelamentos' && <Cancellations />}
      {tab === 'inteligente' && <AgendaIntelPanel />}
    </div>
  );
}
