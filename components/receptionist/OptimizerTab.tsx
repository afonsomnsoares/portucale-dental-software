'use client';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import { AlertBanner, Badge, Empty, MetricCard, SecondaryBtn, Spinner } from '@/components/ui';
import type { OptimizerMove, OptimizerMoveKind, ScheduleOptimization } from '@/lib/types';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário". A aba Eficiência
// mostra o diagnóstico (ocupação, fragmentação); esta mostra o que fazer com ele.
//
// As propostas com destino único podem agora ser APLICADAS aqui, com um clique de uma
// pessoa (POST /api/schedule-intel/optimizer/apply). O que mudou face ao read-only
// original está no cabeçalho dessa rota: a razão da restrição era «mover uma consulta
// obriga a avisar o doente», e o aviso passou a sair sozinho. As que não têm destino
// único continuam a ser só propostas — encaixar gente da lista de espera ou corrigir uma
// marcação contra as preferências do doente são conversas, não UPDATEs.

const KIND_META: Record<OptimizerMoveKind, { label: string; bg: string; color: string }> = {
  gap_fill: { label: 'Encaixe', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  unassigned_dentist: { label: 'Sem dentista', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  equipment_block: { label: 'Equipamento', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  preference_mismatch: { label: 'Preferência', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  // Os três que faltavam: eram calculados pelo servidor e chegavam aqui sem etiqueta,
  // porque este mapa é indexado pelo tipo do cliente e o tipo estava desatualizado.
  group_visit: { label: 'Agrupar', bg: 'var(--cat-purple-bg, var(--bg-sunken))', color: 'var(--cat-purple)' },
  pull_forward: { label: 'Antecipar', bg: 'var(--cat-teal-bg, var(--bg-sunken))', color: 'var(--cat-teal)' },
  consolidate: { label: 'Encostar', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
};

function formatHours(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export default function OptimizerTab({
  optimization,
  loading,
  onApplied,
}: {
  optimization: ScheduleOptimization | null;
  loading?: boolean;
  /** Recarregar a lista: aplicar uma proposta invalida as outras que tocavam no mesmo lugar. */
  onApplied?: () => void;
}) {
  const { api } = useAuth();
  const [aAplicar, setAAplicar] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<string>('');

  async function aplicar(m: OptimizerMove) {
    setAAplicar(m.key);
    setErro('');
    setFeito('');
    try {
      const r: { from: string; to: string; patientWillBeNotified: boolean } = await api(
        '/schedule-intel/optimizer/apply',
        { method: 'POST', body: { key: m.key } },
      );
      setFeito(
        `${r.from} → ${r.to}.${r.patientWillBeNotified ? ' O doente vai ser avisado.' : ' Nada muda para o doente.'}`,
      );
      onApplied?.();
    } catch (e) {
      // 409 quando a agenda mudou desde que esta lista foi desenhada — a proposta já não
      // existe no recálculo do servidor. Recarregar é a resposta certa, não insistir.
      setErro(e instanceof Error ? e.message : 'Não foi possível aplicar.');
      onApplied?.();
    } finally {
      setAAplicar(null);
    }
  }

  if (loading) return <Spinner />;
  if (!optimization) return <Empty message="Sem dados de otimização disponíveis." />;

  const { moves, totals, warnings, windowDays } = optimization;
  const byKind = moves.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {warnings.map((w) => (
        <AlertBanner key={w} type="warning">
          {w}
        </AlertBanner>
      ))}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}
        className="mb-5"
      >
        <MetricCard
          label="CAPACIDADE RECUPERÁVEL"
          value={formatHours(totals.recoverableMinutes)}
          sub={`nos próximos ${windowDays} dias, se as propostas de encaixe forem aceites`}
          color={totals.recoverableMinutes > 0 ? 'var(--urgency-ok)' : 'var(--text-muted)'}
        />
        <MetricCard
          label="PROPOSTAS"
          value={totals.moves}
          sub={
            Object.entries(byKind)
              .map(([k, n]) => `${n} ${KIND_META[k as OptimizerMoveKind]?.label.toLowerCase() || k}`)
              .join(' · ') || 'nada a otimizar'
          }
          color="var(--accent)"
        />
      </div>

      {erro && <AlertBanner type="danger">{erro}</AlertBanner>}
      {feito && <AlertBanner type="success">{feito}</AlertBanner>}

      {!moves.length ? (
        <Empty message="Nada a otimizar — a agenda está sem buracos preenchíveis nem marcações incompletas." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {moves.map((m) => {
            const meta = KIND_META[m.kind];
            return (
              <div
                key={m.key}
                className="card"
                style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between mb-1" style={{ gap: 12 }}>
                  <span
                    style={{
                      fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {m.title}
                  </span>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                    {m.gainMinutes > 0 && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          fontWeight: 'var(--weight-bold)',
                          color: 'var(--urgency-ok)',
                        }}
                      >
                        +{formatHours(m.gainMinutes)}
                      </span>
                    )}
                    <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {m.detail}
                </div>
                {m.apply && (
                  <div className="flex items-center gap-3 mt-2">
                    <SecondaryBtn onClick={() => aplicar(m)} disabled={aAplicar !== null}>
                      {aAplicar === m.key ? 'A aplicar…' : 'Aplicar'}
                    </SecondaryBtn>
                    {/* Dito antes do clique e não depois: quem aplica precisa de saber se
                        tem de telefonar ao doente ou se a mensagem sai sozinha. */}
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      {m.apply.notifiesPatient
                        ? 'Muda o dia/hora — o doente é avisado automaticamente.'
                        : 'Não muda nada do que foi dito ao doente.'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
