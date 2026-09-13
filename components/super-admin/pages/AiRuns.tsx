'use client';
import { useCallback, useState } from 'react';
import { useAuth } from '@/app/providers';
import { AlertBanner, Badge, Empty, ErrorState, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface Run {
  id: string;
  job_name: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  tenant_name: string | null;
  tenant_city: string | null;
  agentId: string | null;
  durationMs: number | null;
  error: string | null;
}
interface Stage {
  key: string;
  label: string;
  recorded: boolean;
  value: unknown;
}
interface Detail {
  run: {
    id: string;
    jobName: string;
    agentId: string | null;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    tenantName: string | null;
    tenantCity: string | null;
    durationMs: number | null;
  };
  stages: Stage[];
  missingStages: string[];
}
interface Summary {
  id: string;
  name: string;
  icon: string;
  ai: string;
  total: number;
  failed: number;
  lastAt: string | null;
}

const STATUS_META: Record<string, { bg: string; color: string }> = {
  completed: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  failed: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
};

// A página de observabilidade das execuções: a lista à esquerda, o traço de uma
// execução à direita.
//
// ─── O que está aqui e o que não está ───────────────────────────────────────
// O traço pedido era INPUT → contexto → decisão → ferramentas → ações → resultado →
// avaliação. Só três desses estágios estão gravados hoje. Os outros aparecem à mesma,
// a cinzento e marcados «não gravado», em vez de serem omitidos — porque a diferença
// entre «o agente não usou ferramentas» e «ninguém registou que ferramentas usou» é
// exatamente a diferença que uma página destas existe para mostrar.
export default function AiRuns() {
  const { api } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [erroDetalhe, setErroDetalhe] = useState('');
  const [agent, setAgent] = useState('');
  const dataQuery = useQuery<{ runs: Run[]; summary: Summary[] }>(
    `/platform/agent-runs${agent ? `?agent=${agent}` : ''}`,
  );
  const data = dataQuery.data ?? null;

  const open = useCallback(
    (id: string) => {
      setSelected(id);
      setDetail(null);
      setErroDetalhe('');
      api(`/platform/agent-runs/${id}`)
        .then(setDetail)
        .catch((e: unknown) => {
          // Sem isto, uma execução cujo detalhe falhasse ficava a mostrar o
          // esqueleto vazio para sempre, indistinguível de uma sem passos.
          setErroDetalhe(e instanceof Error ? e.message : 'Não foi possível ler o detalhe.');
        });
    },
    [api],
  );

  if (dataQuery.error) return <ErrorState error={dataQuery.error} onRetry={dataQuery.refetch} />;
  if (!data) return <Spinner />;

  return (
    <div>
      <PageHeader title="Execuções" sub={`${data.runs.length} passagens de agentes em toda a rede`} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <GhostBtn
          onClick={() => setAgent('')}
          style={!agent ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
        >
          TODOS
        </GhostBtn>
        {data.summary.map((s) => (
          <GhostBtn
            key={s.id}
            onClick={() => setAgent(s.id)}
            style={agent === s.id ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
          >
            {s.icon} {s.name} {s.total ? `(${s.total})` : ''}
            {s.failed ? <span style={{ color: 'var(--urgency-critical)', marginLeft: 4 }}>●</span> : null}
          </GhostBtn>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1.2fr' : '1fr', gap: 16 }}>
        <div className="card p-0" style={{ overflow: 'hidden' }}>
          {!data.runs.length ? (
            <Empty message="Nenhuma execução registada — os agentes ainda não correram" />
          ) : (
            data.runs.map((r) => {
              const m = STATUS_META[r.status] || STATUS_META.completed;
              const isSel = selected === String(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open(String(r.id))}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '11px 16px',
                    border: 'none',
                    borderBottom: '1px solid var(--bg-page)',
                    borderLeft: `3px solid ${isSel ? 'var(--accent)' : 'transparent'}`,
                    background: isSel ? 'var(--bg-page)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <Badge label={r.status} {...m} />
                    <span
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--text-primary)',
                        fontFamily: '"JetBrains Mono",monospace',
                      }}
                    >
                      {r.job_name}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      #{r.id}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    {r.tenant_name || 'Plataforma'} ·{' '}
                    {r.started_at ? new Date(r.started_at).toLocaleString('pt-PT') : '—'}
                    {r.durationMs !== null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected && (
          <div className="card p-5" style={{ alignSelf: 'start', position: 'sticky', top: 0 }}>
            {erroDetalhe ? (
              <AlertBanner type="danger">{erroDetalhe}</AlertBanner>
            ) : !detail ? (
              <Spinner />
            ) : (
              <>
                <div style={{ marginBottom: 4, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  {detail.run.tenantName || 'Plataforma (todas as clínicas)'} · Execução #{detail.run.id}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <span
                    style={{
                      fontSize: 'var(--text-base)',
                      fontWeight: 'var(--weight-bold)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {detail.run.jobName}
                  </span>
                  <Badge label={detail.run.status} {...(STATUS_META[detail.run.status] || STATUS_META.completed)} />
                  <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {new Date(detail.run.startedAt).toLocaleString('pt-PT')}
                    {detail.run.durationMs !== null ? ` · ${(detail.run.durationMs / 1000).toFixed(1)}s` : ''}
                  </span>
                </div>

                {detail.stages.map((s, i) => (
                  <div key={s.key} style={{ display: 'flex', gap: 12 }}>
                    {/* Coluna do traço: bolinha + linha vertical até ao estágio seguinte. */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 'var(--radius-pill)',
                          marginTop: 4,
                          background: s.recorded ? 'var(--accent)' : 'transparent',
                          border: s.recorded ? 'none' : '2px dashed var(--text-muted)',
                        }}
                      />
                      {i < detail.stages.length - 1 && (
                        <span style={{ flex: 1, width: 2, background: 'var(--bg-sunken)' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 16, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--weight-semibold)',
                          color: s.recorded ? 'var(--text-primary)' : 'var(--text-muted)',
                          marginBottom: 4,
                        }}
                      >
                        {s.label}
                        {!s.recorded && (
                          <span
                            style={{
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 'var(--weight-semibold)',
                              color: 'var(--text-muted)',
                              marginLeft: 8,
                            }}
                          >
                            NÃO GRAVADO
                          </span>
                        )}
                      </div>
                      {s.recorded ? (
                        <pre
                          style={{
                            fontSize: 'var(--text-2xs)',
                            fontFamily: '"JetBrains Mono",monospace',
                            background: 'var(--bg-page)',
                            padding: 12,
                            borderRadius: 'var(--radius-control)',
                            margin: 0,
                            maxHeight: 220,
                            overflow: 'auto',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {JSON.stringify(s.value, null, 2)}
                        </pre>
                      ) : (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          Nenhum código escreve este estágio hoje.
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <p
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-secondary)',
                    lineHeight: 'var(--text-xs-leading)',
                    margin: 0,
                    paddingTop: 12,
                    borderTop: '1px solid var(--bg-sunken)',
                  }}
                >
                  Faltam {detail.missingStages.length} dos 7 estágios. Gravá-los é uma alteração a lib/jobsRunner.ts e a
                  lib/agents/aiClient.ts — cada agente teria de escrever o contexto que leu e a decisão que tomou, não
                  só o resultado. É o que separa isto de observabilidade a sério.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
