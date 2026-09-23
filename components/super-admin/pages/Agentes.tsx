'use client';
import AiAgents from '@/components/super-admin/pages/AiAgents';
import AiConsumo from '@/components/super-admin/pages/AiConsumo';
import AiFailures from '@/components/super-admin/pages/AiFailures';
import AiRuns from '@/components/super-admin/pages/AiRuns';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// ─── Cinco entradas de menu, dois endpoints ─────────────────────────────────
// O grupo AGENTES do menu de plataforma tinha «Agentes», «Modelos», «Execuções»,
// «Custos de IA» e «Falhas». Por baixo eram dois pedidos:
//
//   /platform/agent-runs  → Agentes (o catálogo), Execuções (a lista) e Falhas
//                           (que é `?status=failed`, ou seja, um filtro da lista);
//   /platform/ai-usage    → Modelos e Custos, literalmente a mesma leitura duas vezes.
//
// Cinco entradas não são cinco assuntos: são quatro perguntas sobre um subsistema só.
// Aqui são separadores, que é o que já eram — e a barra lateral fica com uma linha onde
// tinha cinco.
//
// «Falhas» ficou como separador próprio e não como filtro de Execuções porque não é o
// mesmo recorte: junta as passagens rebentadas às chamadas ao modelo que falharam em
// silêncio, e essas segundas não aparecem na lista de execuções de todo.
//
// ─── Porque é que esta página deixou de ler no servidor ─────────────────────
// «Modelos» e «Custos» liam o aiUsage() no servidor para pintarem à primeira. Fundidos
// num separador que não é o de entrada, essa leitura passou a atrasar o ecrã de quem
// abre «Agentes» e nunca chega ao consumo — paga-se sempre, aproveita-se às vezes. O
// separador pede os seus dados quando for aberto, e /api/platform/ai-usage continua a
// ser o porteiro deles.
const TABS = [
  { key: 'agentes', label: 'Agentes' },
  { key: 'execucoes', label: 'Execuções' },
  { key: 'falhas', label: 'Falhas' },
  { key: 'consumo', label: 'Consumo' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Agentes() {
  const [tab, setTab] = useTabHash(CHAVES, 'agentes');

  return (
    <div>
      <PageHeader title="Agentes" sub="O catálogo, o que correu, o que falhou e o que custou — em toda a rede" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'agentes' && <AiAgents />}
      {tab === 'execucoes' && <AiRuns />}
      {tab === 'falhas' && <AiFailures />}
      {tab === 'consumo' && <AiConsumo />}
    </div>
  );
}
