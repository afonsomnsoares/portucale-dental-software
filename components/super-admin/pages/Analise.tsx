'use client';
import Reports from '@/components/shared/Reports';
import AnalyticsRetention from '@/components/super-admin/pages/AnalyticsRetention';
import AnalyticsUsage from '@/components/super-admin/pages/AnalyticsUsage';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// ─── «Utilização» e «Retenção» liam a mesma linha ───────────────────────────
// Duas entradas de menu sobre /platform/usage, com a mesma `UsageRow` por baixo: uma
// contava o trabalho, a outra media há quanto tempo ele não acontece. São duas leituras
// da mesma tabela, e uma tabela lida de duas maneiras é um ecrã com dois separadores,
// não dois sítios.
//
// «Análise da Plataforma» juntou-se a elas porque responde à mesma pergunta por outro
// lado — compara clínicas em vez de as listar. As três juntas são «como é que a rede
// está a ir»; separadas eram três entradas que obrigavam a escolher antes de saber.
//
// As duas liam o tenantUsage() no servidor para pintarem à primeira. Como separadores
// que não são o de entrada, essa leitura atrasava o ecrã de quem abre «Análise» e fica
// na comparação entre clínicas — e as duas partilham a leitura, pelo que abrir uma
// aquece a outra de qualquer maneira.
const TABS = [
  { key: 'plataforma', label: 'Plataforma' },
  { key: 'utilizacao', label: 'Utilização' },
  { key: 'retencao', label: 'Retenção' },
];

const CHAVES = TABS.map((t) => t.key);

export default function Analise() {
  const [tab, setTab] = useTabHash(CHAVES, 'plataforma');

  return (
    <div>
      <PageHeader title="Análise" sub="Como está a rede — comparação entre clínicas, trabalho real e retenção" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'plataforma' && <Reports />}
      {tab === 'utilizacao' && <AnalyticsUsage />}
      {tab === 'retencao' && <AnalyticsRetention />}
    </div>
  );
}
