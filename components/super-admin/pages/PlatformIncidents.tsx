'use client';
import { Badge, Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface Run {
  id: string;
  job_name: string;
  started_at: string | null;
  tenant_name: string | null;
  error: string | null;
}
interface Insight {
  id: string;
  severity: string;
  title: string;
  body: string;
  agent_id: string;
  created_at: string;
  tenant_name: string | null;
}

// Incidentes DE PLATAFORMA — coisas partidas do lado da Portucale.
//
// Não confundir com os incidentes de uma clínica (quedas, avarias de equipamento,
// ocorrências com doentes), que já existem em `incidents` e se veem dentro da clínica,
// em Operações. Aqueles são da clínica e é lá que se fecham; estes são nossos.
//
// Como não há tabela de incidentes de plataforma, o que aqui está é derivado do que
// avariou de facto: passagens de agentes que rebentaram, agrupadas por tarefa (uma
// tarefa a falhar em cinco clínicas é UM incidente, não cinco), mais o que os agentes
// classificaram como crítico.
export default function PlatformIncidents() {
  const runsQuery = useQuery<{ runs: Run[] }>('/platform/agent-runs?status=failed&limit=200');
  const criticalQuery = useQuery<Insight[]>('/platform/insights?severity=critical');
  const runs = runsQuery.data ? runsQuery.data.runs || [] : null;
  const critical = criticalQuery.data ?? [];

  if (!runs) return <Spinner />;

  // Agrupa por tarefa: o incidente é «a tarefa X está a falhar», não cada ocorrência.
  const byJob = new Map<string, Run[]>();
  for (const r of runs) byJob.set(r.job_name, [...(byJob.get(r.job_name) || []), r]);
  const incidents = [...byJob.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <PageHeader title="Incidentes" sub="Do lado da plataforma — o que está partido aqui" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="INCIDENTES ABERTOS"
          value={incidents.length}
          sub="tarefas a falhar"
          color={incidents.length ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
        />
        <MetricCard
          label="OCORRÊNCIAS"
          value={runs.length}
          sub="passagens falhadas no total"
          color={runs.length ? 'var(--urgency-soon)' : 'var(--urgency-ok)'}
        />
        <MetricCard
          label="ALERTAS CRÍTICOS"
          value={critical.length}
          sub="classificados pelos agentes"
          color={critical.length ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
        />
      </div>

      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-4">TAREFAS A FALHAR</div>
        {!incidents.length ? (
          <Empty message="Nada partido — nenhuma tarefa falhou" />
        ) : (
          incidents.map(([job, occurrences]) => {
            // Uma tarefa a falhar em várias clínicas ao mesmo tempo é quase sempre um
            // problema nosso; numa clínica só, quase sempre um problema dos dados dela.
            const clinics = new Set(occurrences.map((o) => o.tenant_name || 'Plataforma'));
            const widespread = clinics.size > 1;
            return (
              <div key={job} style={{ padding: '12px 0', borderBottom: '1px solid var(--bg-page)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <Badge
                    label={widespread ? 'TRANSVERSAL' : 'UMA CLÍNICA'}
                    bg={widespread ? 'var(--urgency-critical-bg)' : 'var(--urgency-soon-bg)'}
                    color={widespread ? 'var(--urgency-critical)' : 'var(--urgency-soon)'}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: '"JetBrains Mono",monospace',
                    }}
                  >
                    {job}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {occurrences.length} ocorrências · {clinics.size} {clinics.size === 1 ? 'clínica' : 'clínicas'}
                  </span>
                </div>
                {occurrences[0]?.error && (
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono",monospace',
                      color: 'var(--urgency-critical)',
                      background: 'var(--urgency-critical-bg)',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-control)',
                      marginBottom: 6,
                      overflowX: 'auto',
                    }}
                  >
                    {occurrences[0].error}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {[...clinics].join(' · ')} · mais recente{' '}
                  {occurrences[0]?.started_at ? new Date(occurrences[0].started_at).toLocaleString('pt-PT') : '—'}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">ALERTAS CRÍTICOS DOS AGENTES</div>
        {!critical.length ? (
          <Empty message="Nenhum alerta crítico por tratar" />
        ) : (
          critical.map((c) => (
            <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--bg-page)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Badge label="CRÍTICO" bg="var(--urgency-critical-bg)" color="var(--urgency-critical)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {c.tenant_name || 'Plataforma'} · {new Date(c.created_at).toLocaleDateString('pt-PT')}
                </span>
              </div>
              {c.body && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{c.body}</p>
              )}
            </div>
          ))
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        Derivado do que avariou, não de uma fila de incidentes: não há tabela de incidentes de plataforma, e uma fila
        vazia que alguém tem de alimentar à mão seria menos verdadeira do que isto. Os incidentes de cada clínica
        (equipamento, ocorrências) vivem na clínica, em Operações.
      </p>
    </div>
  );
}
