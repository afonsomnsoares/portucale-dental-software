'use client';
import { useCallback, useState } from 'react';
import { useAuth } from '@/app/providers';
import { AlertBanner, Badge, Empty, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';
import type { AgentInsight, AgentStatus } from '@/lib/types/agent';

// Página de Agentes do admin da clínica.
//
// Regra que governa este ecrã: não mostra nada que não seja verdade. Os cartões
// vêm de lib/agents/registry.ts (o desenho), e a última execução de cada um vem de
// job_runs (o que realmente aconteceu). Um agente que nunca correu diz que nunca
// correu. Operações e Lead já têm IA ligada (o cartão diz "IA ativa"); os restantes
// continuam determinísticos e o cartão também diz isso — prometer capacidade que
// não existe é como se perdeu a Imagiologia (ver o commit 353c129).
export default function ClinicAgentsPage() {
  const { api } = useAuth();
  const agentsQuery = useQuery<{ agents: AgentStatus[] }>('/agents');
  const insightsQuery = useQuery<AgentInsight[]>('/agent-insights');
  const agents = agentsQuery.data?.agents ?? [];
  const insights = insightsQuery.data ?? [];
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    agentsQuery.refetch();
    insightsQuery.refetch();
  }, [agentsQuery, insightsQuery]);

  async function resolveInsight(id: string) {
    setErr('');
    try {
      await api('/agent-insights', { method: 'PATCH', body: { id } });
      load();
    } catch (e) {
      // Dar um insight por tratado sem que fique gravado fá-lo reaparecer na
      // próxima leitura, como se ninguém lhe tivesse tocado.
      setErr(e instanceof Error ? e.message : 'Não foi possível dar este alerta por tratado.');
    }
  }

  const comRegisto = agents.filter((a) => a.lastRun).length;

  return (
    <div>
      <PageHeader title="Agentes" sub="O que corre sozinho nesta clínica, e quem responde por cada parte">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      <AlertBanner type="info">
        Estes agentes agrupam as {agents.reduce((n, a) => n + a.jobs.length, 0)} tarefas automáticas que já correm hoje.
        Os que <strong>agem</strong> fazem-no dentro de fronteiras: o Operações prepara a encomenda de stock mas deixa-a
        em rascunho, o Lead escreve a resposta mas não a envia. Os que <strong>analisam</strong> (Agenda, Doente,
        Finanças, Gestão, Grupo) não agem de todo — escrevem as conclusões em baixo. O Conformidade continua
        determinístico de propósito: apagar dados por decisão de um modelo é o que a fronteira dele proíbe.
      </AlertBanner>

      {err && (
        <div
          className="card p-4 mb-4"
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      {agentsQuery.loading ? (
        <div className="card p-5">
          <Spinner />
        </div>
      ) : !agents.length ? (
        <Empty message="Sem agentes registados." />
      ) : (
        <>
          <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {comRegisto} de {agents.length} com execuções registadas nesta clínica
          </div>
          <div className="grid-cards" style={{ gap: 16 }}>
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>

          <div className="card p-5 mt-4">
            <div className="section-label mb-3">🔎 O QUE OS AGENTES ENCONTRARAM</div>
            {insights.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Nada por tratar. Os agentes de análise escrevem aqui quando a próxima corrida encontrar alguma coisa —
                sem ANTHROPIC_API_KEY configurada, não correm de todo e esta lista fica sempre vazia.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {insights.map((insight) => (
                  <InsightRow key={insight.id} insight={insight} onResolve={() => resolveInsight(insight.id)} />
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 mt-4" style={{ borderLeft: '4px solid var(--cat-purple)' }}>
            <div className="section-label mb-2">💬 COMUNICAÇÃO — CAMADA DE POLÍTICA</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Comunicar não é um agente, é o canal por onde todos passam. O consentimento do doente, o canal preferido,
              o limite de mensagens por semana, as horas de silêncio e a deduplicação entre agentes vivem num sítio só —
              senão os seis escrevem à mesma pessoa na mesma manhã.
            </p>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)', margin: '12px 0 0' }}>
              Hoje: a tarefa <code>send</code> despacha a fila e <code>lib/commPrefs.ts</code> guarda as preferências.
              Os limites e a deduplicação ainda não existem.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentStatus }) {
  const run = agent.lastRun;
  const falhou = run?.status === 'failed';

  return (
    <div
      className="card p-5"
      style={{
        borderLeft: `4px solid ${falhou ? 'var(--urgency-critical)' : run ? 'var(--urgency-ok)' : 'var(--border-subtle)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{agent.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{agent.name}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {agent.jobs.length} {agent.jobs.length === 1 ? 'tarefa' : 'tarefas'}
          </div>
        </div>
        <Badge
          label={agent.ai === 'none' ? 'IA por ligar' : agent.ai === 'partial' ? 'IA parcial' : 'IA ativa'}
          bg={agent.ai === 'none' ? 'var(--bg-page)' : 'var(--urgency-ok-bg)'}
          color={agent.ai === 'none' ? 'var(--text-secondary)' : 'var(--urgency-ok)'}
        />
      </div>

      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px' }}>
        {agent.summary}
      </p>

      <p
        className="text-xs"
        style={{ color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 12px', fontStyle: 'italic' }}
      >
        Fronteira: {agent.boundary}
      </p>

      <div className="section-label mb-2">TAREFAS QUE GOVERNA</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {agent.jobs.map((job) => (
          <span
            key={job}
            style={{
              fontFamily: '"JetBrains Mono",monospace',
              fontSize: 11,
              background: 'var(--bg-page)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-control)',
              padding: '2px 7px',
            }}
          >
            {job}
          </span>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--bg-page)', paddingTop: 10 }}>
        {!run ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sem execuções registadas nesta clínica.
          </div>
        ) : (
          <div className="text-xs" style={{ color: falhou ? 'var(--urgency-critical)' : 'var(--text-secondary)' }}>
            Última execução: <strong>{run.jobName}</strong> · {falhou ? 'falhou' : 'concluída'} ·{' '}
            {new Date(run.startedAt).toLocaleString('pt-PT')}
          </div>
        )}
      </div>
    </div>
  );
}

const SEVERITY_STYLE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  critical: {
    label: 'Crítico',
    bg: 'var(--urgency-critical-bg)',
    color: 'var(--urgency-critical)',
    border: 'var(--urgency-critical)',
  },
  warning: {
    label: 'Atenção',
    bg: 'var(--urgency-soon-bg)',
    color: 'var(--urgency-soon)',
    border: 'var(--urgency-soon)',
  },
  info: { label: 'Nota', bg: 'var(--bg-page)', color: 'var(--text-secondary)', border: 'var(--border-subtle)' },
};

function InsightRow({ insight, onResolve }: { insight: AgentInsight; onResolve: () => void }) {
  const style = SEVERITY_STYLE[insight.severity] || SEVERITY_STYLE.info;
  const impact = insight.impact_eur == null ? null : Number(insight.impact_eur);

  return (
    <div
      style={{
        border: `1px solid ${style.border}`,
        borderRadius: 'var(--radius-control)',
        padding: 12,
        background: style.bg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Badge label={style.label} bg="var(--bg-surface)" color={style.color} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
              {insight.agent_id}
            </span>
            {impact != null && impact > 0 && (
              <span className="text-xs" style={{ color: style.color, fontWeight: 800 }}>
                {formatEUR(impact)}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{insight.title}</div>
          {insight.body && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
              {insight.body}
            </p>
          )}
        </div>
        <GhostBtn onClick={onResolve} style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
          Tratado
        </GhostBtn>
      </div>
    </div>
  );
}
