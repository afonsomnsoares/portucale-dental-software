'use client';
// ─── Configuração do Sistema ────────────────────────────────────────────────
// Substituiu o NotInstrumented que aqui estava. As duas peças que a versão
// estacionada pedia — versão em execução e estado das migrações — são exatamente
// as que esta desenha, e mais nada: o resto do que ali estava escrito continua a
// não existir, e inventá-lo agora seria repetir o erro que aquele componente foi
// criado para evitar.
//
// A regra que governa este ecrã inteiro: mostra-se QUE um segredo está definido,
// nunca o VALOR. Não há aqui nenhum caminho por onde um valor passe — a leitura
// (lib/platformStats.ts) devolve booleanos, por isso a UI não tem sequer a
// oportunidade de o revelar por acidente.
import { AlertTriangle, Check, Database, GitCommit, Minus } from 'lucide-react';
import { Empty, ErrorState, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { SystemConfigInfo } from '@/lib/types/platform';

const linha = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
  padding: '9px 0',
  borderBottom: '1px solid var(--bg-page)',
} as const;

const mono = { fontFamily: '"JetBrains Mono",monospace', fontSize: 'var(--text-xs)' } as const;

export default function SystemConfig({ initialData }: { initialData?: SystemConfigInfo } = {}) {
  const q = useQuery<SystemConfigInfo>('/platform/system-config', { initialData });
  const c = q.data ?? null;

  if (q.loading) return <Spinner />;
  if (q.error)
    return <ErrorState error={q.error} onRetry={q.refetch} message="Não foi possível ler a configuração do sistema." />;
  if (!c) return <Empty message="A configuração veio vazia" />;

  const { runtime, migrations, secrets } = c;
  // onDisk === null é o caso NORMAL em produção: a imagem não copia scripts/.
  // Tratá-lo como «0 pendentes» seria dizer que está tudo aplicado sem ter lido
  // nada — a diferença entre não saber e não haver.
  const semRepo = migrations.onDisk === null;
  const porAplicar = migrations.pending.length;

  const grupos = [...new Set(secrets.map((s) => s.group))];

  return (
    <div>
      <PageHeader title="Configuração do Sistema" sub="O que este processo tem à frente agora" />

      <div className="grid-cards" style={{ gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="VERSÃO"
          value={runtime.appVersion || '—'}
          sub={runtime.appVersion ? 'package.json' : 'não legível'}
          color="var(--accent)"
          icon={<GitCommit size={22} />}
        />
        <MetricCard
          label="AMBIENTE"
          value={runtime.env}
          sub={`Node ${runtime.node}`}
          color={runtime.env === 'production' ? 'var(--urgency-ok)' : 'var(--cat-purple)'}
          icon={<Database size={22} />}
        />
        <MetricCard
          label="MIGRAÇÕES APLICADAS"
          value={migrations.applied.length}
          sub={semRepo ? 'repositório não legível aqui' : `${migrations.onDisk?.length ?? 0} no repositório`}
          color="var(--accent)"
          icon={<Check size={22} />}
        />
        <MetricCard
          label="POR APLICAR"
          value={semRepo ? '?' : porAplicar}
          sub={semRepo ? 'não dá para saber' : porAplicar ? 'correr db:migrate' : 'nada pendente'}
          color={semRepo ? 'var(--urgency-soon)' : porAplicar ? 'var(--urgency-critical)' : 'var(--urgency-ok)'}
          icon={semRepo ? <Minus size={22} /> : <AlertTriangle size={22} />}
        />
      </div>

      {/* O commit não é uma métrica: hoje não há nada a injetá-lo, e um cartão
          grande com um traço lê-se como avaria em vez de como «por configurar». */}
      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-2">COMMIT EM EXECUÇÃO</div>
        {runtime.commit ? (
          <div style={{ ...mono, fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{runtime.commit}</div>
        ) : (
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              lineHeight: 'var(--leading-prose)',
              margin: 0,
            }}
          >
            Não definido. Nada injeta o commit no processo hoje — para o ver aqui, passa{' '}
            <span style={mono}>BUILD_COMMIT</span> (ou <span style={mono}>GIT_COMMIT</span>) ao arrancar a aplicação.
            Fica vazio em vez de mostrar «desconhecido»: um valor a dizer que não há valor acaba por se ler como valor.
          </p>
        )}
      </div>

      <div className="grid-pair" style={{ gap: 16 }}>
        <div className="card p-5">
          <div className="section-label mb-4">ESTADO DAS MIGRAÇÕES</div>

          {semRepo ? (
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                lineHeight: 'var(--leading-prose)',
                margin: 0,
              }}
            >
              O diretório <span style={mono}>scripts/migrations</span> não é legível a partir deste processo — é o que
              acontece na imagem de produção, que não o copia. Sabe-se o que está aplicado na base (
              {migrations.applied.length}); não se sabe o que o repositório traz, por isso não se afirma que está tudo
              em dia.
            </p>
          ) : porAplicar ? (
            <>
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--urgency-critical)',
                  margin: '0 0 12px',
                  lineHeight: 'var(--leading-prose)',
                }}
              >
                {porAplicar} por aplicar. A base está atrás do código.
              </p>
              {migrations.pending.map((m) => (
                <div key={m} style={linha}>
                  <span style={{ ...mono, color: 'var(--text-primary)' }}>{m}</span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--urgency-critical)' }}>PENDENTE</span>
                </div>
              ))}
            </>
          ) : (
            <Empty message="Base e repositório coincidem" />
          )}

          {/* Drift é o caso raro e o mais difícil de diagnosticar às cegas: a base
              tem migrações que o repositório já não tem. */}
          {migrations.drift.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--bg-sunken)' }}>
              <div className="section-label mb-2">APLICADAS SEM FICHEIRO NO REPOSITÓRIO</div>
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                  margin: '0 0 10px',
                  lineHeight: 'var(--leading-prose)',
                }}
              >
                A base está à frente do código — houve um rollback do repositório sem rollback da base, ou uma migração
                aplicada e nunca commitada.
              </p>
              {migrations.drift.map((m) => (
                <div key={m} style={linha}>
                  <span style={{ ...mono, color: 'var(--text-primary)' }}>{m}</span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--urgency-soon)' }}>SEM FICHEIRO</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="section-label mb-2">SEGREDOS E CREDENCIAIS</div>
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              margin: '0 0 14px',
              lineHeight: 'var(--leading-prose)',
            }}
          >
            Só se mostra se está definido. O valor nunca sai do servidor — a leitura devolve booleanos, por isso não há
            por onde escapar.
          </p>

          {grupos.map((g) => (
            <div key={g} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 'var(--text-2xs)',
                  letterSpacing: 'var(--text-2xs-tracking)',
                  color: 'var(--text-muted)',
                  fontWeight: 'var(--weight-bold)',
                  marginBottom: 4,
                }}
              >
                {g.toUpperCase()}
              </div>
              {secrets
                .filter((s) => s.group === g)
                .map((s) => (
                  <div key={s.key} style={linha} title={s.note}>
                    <span style={{ ...mono, color: 'var(--text-primary)' }}>{s.key}</span>
                    <span
                      style={{
                        fontSize: 'var(--text-2xs)',
                        fontWeight: 'var(--weight-bold)',
                        letterSpacing: 'var(--text-2xs-tracking)',
                        color: s.set ? 'var(--urgency-ok)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.set ? 'DEFINIDO' : 'POR DEFINIR'}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
