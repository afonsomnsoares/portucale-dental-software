'use client';
import { Activity, Database, ServerCrash, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';

interface Health {
  database: { ok: boolean; latencyMs: number };
  tenantsByStatus: Array<{ status: string; n: number }>;
  jobs24h: { completed: number; failed: number; total: number };
  lastJobRunAt: string | null;
  staleJobs: Array<{ job_name: string; last_at: string }>;
  notInstrumented: string[];
}

export default function Health() {
  const { api } = useAuth();
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/platform/health')
      .then(setH)
      .catch(() => setH(null))
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <Spinner />;
  if (!h) return <Empty message="Não foi possível ler o estado do sistema" />;

  const failRate = h.jobs24h.total ? Math.round((h.jobs24h.failed / h.jobs24h.total) * 100) : 0;

  return (
    <div>
      <PageHeader title="Estado do Sistema" sub="Medido agora, em toda a rede" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="BASE DE DADOS"
          value={h.database.ok ? 'OK' : 'FALHA'}
          sub={`${h.database.latencyMs} ms de ida e volta`}
          color={h.database.ok ? 'var(--urgency-ok)' : 'var(--urgency-critical)'}
          icon={<Database size={22} />}
        />
        <MetricCard
          label="EXECUÇÕES 24H"
          value={h.jobs24h.total}
          sub={`${h.jobs24h.completed} concluídas`}
          color="var(--accent)"
          icon={<Activity size={22} />}
        />
        <MetricCard
          label="FALHAS 24H"
          value={h.jobs24h.failed}
          sub={`${failRate}% das execuções`}
          color={h.jobs24h.failed ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
          icon={<ServerCrash size={22} />}
        />
        <MetricCard
          label="ÚLTIMA EXECUÇÃO"
          value={h.lastJobRunAt ? new Date(h.lastJobRunAt).toLocaleTimeString('pt-PT') : '—'}
          sub={h.lastJobRunAt ? new Date(h.lastJobRunAt).toLocaleDateString('pt-PT') : 'nunca correu'}
          color="var(--cat-purple)"
          icon={<Timer size={22} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">CLÍNICAS POR ESTADO</div>
          {!h.tenantsByStatus.length ? (
            <Empty message="Sem clínicas" />
          ) : (
            h.tenantsByStatus.map((r) => (
              <div
                key={r.status}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--bg-page)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{r.status}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.n}</span>
              </div>
            ))
          )}
        </div>

        <div className="card p-5">
          {/* Uma tarefa que já correu e deixou de correr é o sinal mais fiável de
              "algo parou" que este sistema consegue dar sem monitorização externa. */}
          <div className="section-label mb-4">TAREFAS PARADAS HÁ MAIS DE 48H</div>
          {!h.staleJobs.length ? (
            <Empty message="Nenhuma tarefa parada" />
          ) : (
            h.staleJobs.map((j) => (
              <div
                key={j.job_name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--bg-page)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: '"JetBrains Mono",monospace' }}>
                  {j.job_name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--urgency-critical)' }}>
                  {new Date(j.last_at).toLocaleDateString('pt-PT')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card p-5" style={{ marginTop: 16 }}>
        <div className="section-label mb-2">O QUE ESTA PÁGINA AINDA NÃO MEDE</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {h.notInstrumented.join(' · ')} — precisam de monitorização fora da aplicação (a app não se consegue medir a
          si própria quando está em baixo). O que está acima é tudo medido, nada é estimado.
        </p>
      </div>
    </div>
  );
}
