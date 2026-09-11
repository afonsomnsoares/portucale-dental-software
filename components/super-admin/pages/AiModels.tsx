'use client';
import { Badge, DataTable, Empty, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { AiUsage } from '@/lib/types/platform';

// Que modelos esta plataforma usa, onde, e a que preço.
//
// O modelo não é configurável por clínica nem por agente: é uma constante em
// lib/agents/aiClient.ts (AGENT_MODEL), escolhida com uma razão escrita ao lado dela.
// Esta página mostra a escolha em vigor e o que já correu com cada modelo — incluindo
// modelos antigos, que continuam em ai_calls depois de a constante mudar. É essa a
// utilidade: ver que uma troca de modelo aconteceu mesmo, e quando.
export default function AiModels({ initialData }: { initialData?: AiUsage } = {}) {
  const dQuery = useQuery<AiUsage>('/platform/ai-usage', { initialData });
  const d = dQuery.data ?? null;

  if (dQuery.error) return <ErrorState error={dQuery.error} onRetry={dQuery.refetch} />;
  if (!d) return <Spinner />;

  return (
    <div>
      <PageHeader title="Modelos" sub="O que a plataforma usa, e a que preço" />

      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-3">MODELO EM VIGOR</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: '"JetBrains Mono",monospace',
            }}
          >
            {d.configuredModel}
          </span>
          <Badge label="TODOS OS AGENTES" bg="var(--cat-purple-bg)" color="var(--cat-purple)" />
        </div>
        {d.pricePerMTok[d.configuredModel] && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {d.pricePerMTok[d.configuredModel].input} € por milhão de tokens de entrada ·{' '}
            {d.pricePerMTok[d.configuredModel].output} € por milhão de saída
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '12px 0 0' }}>
          Definido em <code>AGENT_MODEL</code> (lib/agents/aiClient.ts), igual para toda a rede. As chamadas dos agentes
          correm em segundo plano, uma por clínica por passagem do cron, e são decisões estruturadas e limitadas — o
          custo por corrida pesa mais aqui do que a capacidade bruta.
        </p>
      </div>

      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-4">MODELOS COM UTILIZAÇÃO REGISTADA</div>
        {!d.byModel.length ? (
          <Empty message="Nenhuma chamada registada ainda" />
        ) : (
          <DataTable
            cols={['Modelo', 'Chamadas', 'Última utilização', '']}
            rows={d.byModel.map((m) => (
              <tr key={m.model}>
                <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12, fontWeight: 600 }}>{m.model}</td>
                <td>{m.calls.toLocaleString('pt-PT')}</td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {m.last_at ? new Date(m.last_at).toLocaleString('pt-PT') : '—'}
                </td>
                <td>
                  {m.model === d.configuredModel ? (
                    <Badge label="EM VIGOR" bg="var(--urgency-ok-bg)" color="var(--urgency-ok)" />
                  ) : (
                    <Badge label="HISTÓRICO" bg="var(--bg-page)" color="var(--text-secondary)" />
                  )}
                </td>
              </tr>
            ))}
          />
        )}
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">QUE AGENTE USA QUE MODELO</div>
        {!d.byAgent.length ? (
          <Empty message="Nenhum agente chamou o modelo nos últimos 30 dias" />
        ) : (
          <DataTable
            cols={['Agente', 'Modelo', 'Chamadas', 'Falhas', 'Duração média']}
            rows={d.byAgent.map((a) => (
              <tr key={`${a.agent}${a.model}`}>
                <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{a.agent}</td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{a.model}</td>
                <td>{a.calls}</td>
                <td style={{ color: a.failed ? 'var(--urgency-critical)' : 'var(--text-secondary)' }}>{a.failed}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{a.avg_ms ? `${a.avg_ms} ms` : '—'}</td>
              </tr>
            ))}
          />
        )}
      </div>
    </div>
  );
}
