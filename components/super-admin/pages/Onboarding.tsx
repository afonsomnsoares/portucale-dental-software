'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { UsageRow } from '@/components/super-admin/usage';
import { Badge, Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';

// Onboarding medido pelo que a clínica JÁ FEZ, não por uma checklist que alguém marca
// à mão. Cada passo abaixo é uma consulta ao estado real: tem equipa? tem doentes? já
// marcou consultas? os agentes já correram lá?
//
// A diferença importa: uma checklist manual diz que o onboarding está completo porque
// alguém clicou; isto diz que está completo porque a clínica está a trabalhar. Quando
// existir um processo formal de onboarding com passos próprios, esta página passa a
// lê-lo — mas até lá, isto é verdade e uma checklist vazia não era.
const STEPS: Array<{ key: string; label: string; done: (r: UsageRow) => boolean }> = [
  { key: 'provisioned', label: 'Clínica provisionada', done: (r) => r.status === 'active' },
  { key: 'team', label: 'Equipa criada', done: (r) => r.active_users > 0 },
  { key: 'patients', label: 'Doentes carregados', done: (r) => r.patients > 0 },
  { key: 'booking', label: 'A marcar consultas', done: (r) => r.appts_30d > 0 },
  { key: 'agents', label: 'Agentes a correr', done: (r) => r.agent_runs_7d > 0 },
];

export default function Onboarding() {
  const { api } = useAuth();
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    api('/platform/usage')
      .then(setRows)
      .catch(() => setRows([]));
  }, [api]);

  if (!rows) return <Spinner />;

  const progress = (r: UsageRow) => STEPS.filter((s) => s.done(r)).length;
  // Em onboarding = ainda não completou todos os passos. Ordenadas por quem está mais
  // perto do fim, que é por onde vale a pena empurrar.
  const onboarding = rows.filter((r) => progress(r) < STEPS.length).sort((a, b) => progress(b) - progress(a));
  const done = rows.length - onboarding.length;

  return (
    <div>
      <PageHeader title="Onboarding" sub={`${onboarding.length} clínicas por concluir · ${done} a trabalhar`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="EM ONBOARDING"
          value={onboarding.length}
          sub="ainda com passos por fazer"
          color="var(--urgency-soon)"
        />
        <MetricCard label="CONCLUÍDAS" value={done} sub="a trabalhar sozinhas" color="var(--urgency-ok)" />
        <MetricCard
          label="POR PROVISIONAR"
          value={rows.filter((r) => r.status !== 'active').length}
          sub="ainda não ativas"
          color="var(--urgency-critical)"
        />
      </div>

      {!onboarding.length ? (
        <Empty message="Nenhuma clínica em onboarding" />
      ) : (
        onboarding.map((r) => {
          const p = progress(r);
          return (
            <div key={r.id} className="card p-5" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{r.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.city}</span>
                <Badge s={r.status} />
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {p}/{STEPS.length}
                </span>
              </div>

              {/* Barra de progresso — um único div preenchido, sem dependências. */}
              <div
                style={{
                  height: 5,
                  background: 'var(--bg-sunken)',
                  borderRadius: 'var(--radius-pill)',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(p / STEPS.length) * 100}%`,
                    background: p === STEPS.length ? 'var(--urgency-ok)' : 'var(--accent)',
                    borderRadius: 'var(--radius-pill)',
                    transition: 'width .2s',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STEPS.map((s) => {
                  const ok = s.done(r);
                  return (
                    <span
                      key={s.key}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-control)',
                        background: ok ? 'var(--urgency-ok-bg)' : 'var(--bg-page)',
                        color: ok ? 'var(--urgency-ok)' : 'var(--text-muted)',
                        fontWeight: ok ? 600 : 400,
                      }}
                    >
                      {ok ? '✓' : '○'} {s.label}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        Cada passo é medido no estado real da clínica, não marcado à mão. Não há processo formal de onboarding no
        sistema — quando houver, com passos próprios e responsáveis, esta página passa a lê-lo.
      </p>
    </div>
  );
}
