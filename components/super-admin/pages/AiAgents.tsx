'use client';
import { Badge, Empty, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface Summary {
  id: string;
  name: string;
  icon: string;
  ai: string;
  total: number;
  failed: number;
  lastAt: string | null;
}
interface AgentUsage {
  agent: string;
  model: string;
  calls: number;
  failed: number;
  input_tokens: string;
  output_tokens: string;
  avg_ms: number | null;
  costEur: number | null;
}

const AI_META: Record<string, { label: string; bg: string; color: string }> = {
  wired: { label: 'IA LIGADA', bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
  none: { label: 'REGRA FIXA', bg: 'var(--bg-page)', color: 'var(--text-secondary)' },
};

// O catálogo de agentes ao nível da rede: o que cada um é, se usa mesmo um modelo, e
// o que fez em todas as clínicas. A versão por clínica é /dashboard/admin/agents.
export default function AiAgents() {
  // Dois pedidos independentes, e não um Promise.all: o consumo falhar não pode
  // apagar a lista de agentes, que é o assunto da página.
  const runsQuery = useQuery<{ summary: Summary[] }>('/platform/agent-runs?limit=500');
  const usageQuery = useQuery<{ byAgent: AgentUsage[] }>('/platform/ai-usage');
  const runs = runsQuery.data ? runsQuery.data.summary || [] : null;
  const usage = usageQuery.data?.byAgent || [];

  if (runsQuery.error)
    return (
      <ErrorState
        error={runsQuery.error}
        onRetry={runsQuery.refetch}
        message="Não foi possível ler as execuções dos agentes."
      />
    );
  if (!runs) return <Spinner />;

  const wired = runs.filter((r) => r.ai === 'wired').length;
  const totalCalls = usage.reduce((a, u) => a + u.calls, 0);

  return (
    <div>
      <PageHeader title="Agentes" sub={`${runs.length} agentes no catálogo · ${wired} com modelo ligado`} />

      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        <MetricCard label="AGENTES" value={runs.length} sub="no registo" color="var(--accent)" />
        <MetricCard label="COM IA" value={wired} sub="os restantes correm por regra" color="var(--cat-purple)" />
        <MetricCard
          label="EXECUÇÕES"
          value={runs.reduce((a, r) => a + r.total, 0)}
          sub="nas últimas 500 passagens"
          color="var(--urgency-ok)"
        />
        <MetricCard
          label="CHAMADAS AO MODELO"
          value={totalCalls}
          sub="últimos 30 dias"
          color={totalCalls ? 'var(--cat-purple)' : 'var(--text-muted)'}
        />
      </div>

      {!runs.length ? (
        <Empty message="Sem agentes" />
      ) : (
        runs.map((a) => {
          // As chamadas ao modelo são nomeadas por função ('leadAgent.triage'), não
          // pelo id do agente — casam pelo prefixo.
          const mine = usage.filter((u) => u.agent.toLowerCase().startsWith(a.id.toLowerCase()));
          const calls = mine.reduce((s, u) => s + u.calls, 0);
          const cost = mine.reduce((s, u) => s + (u.costEur || 0), 0);
          const m = AI_META[a.ai] || AI_META.none;
          return (
            <div key={a.id} className="card p-5" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{a.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{a.name}</span>
                <Badge label={m.label} bg={m.bg} color={m.color} />
                {a.failed > 0 && (
                  <Badge label={`${a.failed} FALHAS`} bg="var(--urgency-critical-bg)" color="var(--urgency-critical)" />
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {a.lastAt ? `última passagem ${new Date(a.lastAt).toLocaleString('pt-PT')}` : 'nunca correu'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{a.total}</strong> execuções
                </span>
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{calls}</strong> chamadas ao modelo (30d)
                </span>
                {cost > 0 && (
                  <span>
                    <strong style={{ color: 'var(--text-primary)' }}>~{cost.toFixed(2)} €</strong> estimados
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        «Regra fixa» não é um agente por construir: é um agente determinístico, que decide por cálculo em vez de por
        modelo. Para a maioria destas decisões isso é a escolha certa — é auditável, testável sem rede e não custa nada
        por execução.
      </p>
    </div>
  );
}
