'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';

interface Run {
  id: string;
  job_name: string;
  status: string;
  started_at: string | null;
  tenant_name: string | null;
  agentId: string | null;
  error: string | null;
}
interface AgentUsage {
  agent: string;
  calls: number;
  failed: number;
}

// Falhas em dois níveis, porque são falhas diferentes e confundi-las custa tempo:
//
//   a passagem falhou — a tarefa inteira rebentou (job_runs.status = 'failed'), e
//   nada do que ela devia fazer foi feito nessa clínica nesse dia;
//
//   a chamada ao modelo falhou — o agente pediu ao modelo, não conseguiu, e
//   CONTINUOU com a regra fixa (ver callAgentTool). A clínica não notou nada. É
//   silencioso por desenho, e por isso é aqui que tem de aparecer.
export default function AiFailures() {
  const { api } = useAuth();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [agents, setAgents] = useState<AgentUsage[]>([]);

  useEffect(() => {
    Promise.all([
      api('/platform/agent-runs?status=failed&limit=200').catch(() => ({ runs: [] })),
      api('/platform/ai-usage').catch(() => ({ byAgent: [] })),
    ]).then(([r, u]) => {
      setRuns(r.runs || []);
      setAgents(u.byAgent || []);
    });
  }, [api]);

  if (!runs) return <Spinner />;

  const modelFailures = agents.filter((a) => a.failed > 0);
  const totalModelFailed = modelFailures.reduce((a, m) => a + m.failed, 0);
  const totalCalls = agents.reduce((a, m) => a + m.calls, 0);
  const rate = totalCalls ? Math.round((totalModelFailed / totalCalls) * 100) : 0;

  return (
    <div>
      <PageHeader title="Falhas" sub="Passagens rebentadas e chamadas ao modelo falhadas" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="PASSAGENS FALHADAS"
          value={runs.length}
          sub="tarefa inteira não correu"
          color={runs.length ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
        />
        <MetricCard
          label="CHAMADAS AO MODELO FALHADAS"
          value={totalModelFailed}
          sub="agente caiu para a regra fixa"
          color={totalModelFailed ? 'var(--urgency-soon)' : 'var(--urgency-ok)'}
        />
        <MetricCard
          label="TAXA DE FALHA DO MODELO"
          value={`${rate}%`}
          sub={`de ${totalCalls} chamadas (30d)`}
          color={rate > 5 ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
        />
      </div>

      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-4">PASSAGENS QUE REBENTARAM</div>
        {!runs.length ? (
          <Empty message="Nenhuma passagem falhada" />
        ) : (
          runs.map((r) => (
            <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--bg-page)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Badge label="FALHOU" bg="var(--urgency-critical-bg)" color="var(--urgency-critical)" />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    fontFamily: '"JetBrains Mono",monospace',
                  }}
                >
                  {r.job_name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.tenant_name || 'Plataforma'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {r.started_at ? new Date(r.started_at).toLocaleString('pt-PT') : '—'} · #{r.id}
                </span>
              </div>
              {r.error && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: '"JetBrains Mono",monospace',
                    color: 'var(--urgency-critical)',
                    background: 'var(--urgency-critical-bg)',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-control)',
                    overflowX: 'auto',
                  }}
                >
                  {r.error}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">CHAMADAS AO MODELO QUE FALHARAM, POR AGENTE</div>
        {!modelFailures.length ? (
          <Empty message="Nenhuma chamada ao modelo falhou nos últimos 30 dias" />
        ) : (
          modelFailures.map((m) => (
            <div
              key={m.agent}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: '1px solid var(--bg-page)',
              }}
            >
              <span style={{ fontSize: 13, fontFamily: '"JetBrains Mono",monospace', color: 'var(--text-primary)' }}>
                {m.agent}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--urgency-critical)' }}>{m.failed}</strong> de {m.calls} chamadas ·{' '}
                {Math.round((m.failed / m.calls) * 100)}%
              </span>
            </div>
          ))
        )}
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '14px 0 0' }}>
          Estas falhas não aparecem em lado nenhum para a clínica: quando o modelo não responde, o agente cai para a
          regra fixa e o trabalho é feito à mesma. É por isso que uma taxa a subir aqui é o aviso antecipado — a
          qualidade das decisões degrada-se sem nada avariar.
        </p>
      </div>
    </div>
  );
}
