'use client';
import { useCallback, useMemo, useState } from 'react';
import EfficiencyTab from '@/components/receptionist/EfficiencyTab';
import OptimizerTab from '@/components/receptionist/OptimizerTab';
import SlotRiskTab, { type SlotRiskReport } from '@/components/receptionist/SlotRiskTab';
import { Badge, Empty, ErrorState, GhostBtn, PageHeader, RiskBadge, Spinner, Tabs } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatPhonePT } from '@/lib/constants';
import type { AgendaEfficiency, RiskData, RiskHeatmapData, ScheduleOptimization, WaitlistData } from '@/lib/types';

const WEEKDAYS = [
  { key: 1, label: 'Seg' },
  { key: 2, label: 'Ter' },
  { key: 3, label: 'Qua' },
  { key: 4, label: 'Qui' },
  { key: 5, label: 'Sex' },
  { key: 6, label: 'Sáb' },
  { key: 0, label: 'Dom' },
];
const BUCKETS = [
  { key: 'morning', label: 'Manhã (8-12h)' },
  { key: 'afternoon', label: 'Tarde (12-17h)' },
  { key: 'evening', label: 'Final do dia (17-20h)' },
];
const WAITLIST_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  offered: 'Oferta enviada',
  fulfilled: 'Concluído',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

function heatColor(rate: number) {
  if (rate >= 0.4) return { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' };
  if (rate >= 0.2) return { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' };
  if (rate > 0) return { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' };
  return { bg: 'var(--bg-sunken)', color: 'var(--text-muted)' };
}

// Agenda inteligente da própria clínica. A versão de plataforma
// (components/super-admin/pages/ScheduleIntel.tsx) escolhe o tenant primeiro; aqui as rotas
// /schedule-intel/* e /waitlist já confinam tudo a user.tenantId, por isso não se passa
// ?tenantId= e a página carrega direta.
export default function ClinicScheduleIntelPage() {
  const [tab, setTab] = useState('risk');

  // ─── Seis leituras, seis separadores, seis destinos ───────────────────────
  // Cada separador é um assunto independente. Num destino comum, qualquer uma a
  // falhar deixaria o ecrã inteiro parado e as outras cinco não valeriam nada —
  // e esta página existe para comparar os seis ângulos, o que só funciona se os
  // que responderam aparecerem.
  const riskQuery = useQuery<RiskData>('/schedule-intel/risk?days=14');
  const heatmapQuery = useQuery<RiskHeatmapData>('/schedule-intel/heatmap');
  const efficiencyQuery = useQuery<AgendaEfficiency>('/schedule-intel/efficiency?days=14');
  const waitlistQuery = useQuery<WaitlistData>('/waitlist');
  const optimizationQuery = useQuery<ScheduleOptimization>('/schedule-intel/optimizer?days=14');
  // Projeção ao nível do LUGAR — diferente do 'risk' acima, que pontua consultas.
  // Ver o cabeçalho de SlotRiskTab.
  const slotRiskQuery = useQuery<SlotRiskReport>('/schedule-intel/slot-risk?days=21');

  const risk = riskQuery.data ?? null;
  const heatmap = heatmapQuery.data ?? null;
  const efficiency = efficiencyQuery.data ?? null;
  const waitlist = waitlistQuery.data ?? null;
  const optimization = optimizationQuery.data ?? null;
  const slotRisk = slotRiskQuery.data ?? null;

  const load = useCallback(() => {
    riskQuery.refetch();
    heatmapQuery.refetch();
    efficiencyQuery.refetch();
    waitlistQuery.refetch();
    optimizationQuery.refetch();
    slotRiskQuery.refetch();
  }, [riskQuery, heatmapQuery, efficiencyQuery, waitlistQuery, optimizationQuery, slotRiskQuery]);

  // O ecrã só fica parado enquanto o separador ABERTO não tiver nada. Os outros
  // cinco carregam por baixo.
  const queryDoSeparador = {
    risk: riskQuery,
    heatmap: heatmapQuery,
    efficiency: efficiencyQuery,
    optimizer: optimizationQuery,
    'slot-risk': slotRiskQuery,
    waitlist: waitlistQuery,
  }[tab];

  const heatCells = useMemo(() => {
    const map = new Map<string, { total: number; rate: number }>();
    for (const c of heatmap?.cells || []) map.set(`${c.weekday}:${c.bucket}`, { total: c.total, rate: c.rate });
    return map;
  }, [heatmap]);

  const highRiskCount = risk?.highRisk?.length || 0;

  return (
    <div>
      <PageHeader title="Agenda Inteligente" sub="Previsão de faltas, eficiência da agenda e lista de espera">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {queryDoSeparador?.error ? (
        <ErrorState
          error={queryDoSeparador.error}
          onRetry={queryDoSeparador.refetch}
          message="Não foi possível carregar este separador."
        />
      ) : queryDoSeparador?.loading ? (
        <div className="card p-5">
          <Spinner />
        </div>
      ) : (
        <>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'risk', label: 'Risco', count: highRiskCount || undefined },
              { key: 'heatmap', label: 'Heatmap' },
              { key: 'efficiency', label: 'Eficiência' },
              { key: 'optimizer', label: 'Otimizador', count: optimization?.totals.moves || undefined },
              { key: 'slot-risk', label: 'Vagas em Risco', count: slotRisk?.totals.atRisk || undefined },
              { key: 'waitlist', label: 'Lista de Espera', count: waitlist?.pendingOffers?.length || undefined },
            ]}
          />

          {tab === 'slot-risk' && <SlotRiskTab data={slotRisk} loading={slotRiskQuery.loading} />}

          {tab === 'risk' &&
            (!risk?.appointments?.length ? (
              <Empty message="Sem consultas nos próximos 14 dias." />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th className="data-th">Doente</th>
                        <th className="data-th">Contacto</th>
                        <th className="data-th">Consulta</th>
                        <th className="data-th">Risco</th>
                      </tr>
                    </thead>
                    <tbody>
                      {risk.appointments.map((a) => (
                        <tr key={a.id} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                          <td className="data-td" style={{ fontWeight: 600 }}>
                            {a.patient_name}
                          </td>
                          <td className="data-td">{a.phone ? formatPhonePT(a.phone) : '—'}</td>
                          <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                            {String(a.appt_date).slice(0, 10)} · {String(a.start_time).slice(0, 5)} · {a.type}
                          </td>
                          <td className="data-td">
                            <RiskBadge score={a.score} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {tab === 'heatmap' &&
            (!heatmap?.cells?.length ? (
              <Empty message="Ainda sem histórico suficiente (faltas/cancelamentos) para calcular o heatmap." />
            ) : (
              <div className="card p-5">
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Taxa de falta/cancelamento por dia da semana e período, com base nos últimos {heatmap.historyMonths}{' '}
                  meses ({heatmap.sampleSize} registos).
                </p>
                <div className="overflow-x-auto">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th className="data-th">Período</th>
                        {WEEKDAYS.map((w) => (
                          <th key={w.key} className="data-th" style={{ textAlign: 'center' }}>
                            {w.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {BUCKETS.map((b) => (
                        <tr key={b.key}>
                          <td className="data-td" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {b.label}
                          </td>
                          {WEEKDAYS.map((w) => {
                            const cell = heatCells.get(`${w.key}:${b.key}`);
                            const rate = cell?.rate || 0;
                            const cfg = heatColor(rate);
                            return (
                              <td key={w.key} className="data-td" style={{ textAlign: 'center', padding: 6 }}>
                                <div
                                  style={{
                                    background: cfg.bg,
                                    color: cfg.color,
                                    borderRadius: 'var(--radius-control)',
                                    padding: '8px 4px',
                                    fontWeight: 700,
                                    fontSize: 13,
                                  }}
                                >
                                  {cell?.total ? `${Math.round(rate * 100)}%` : '—'}
                                </div>
                                {cell?.total ? (
                                  <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                    {cell.total} marc.
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {tab === 'efficiency' && <EfficiencyTab efficiency={efficiency} />}
          {tab === 'optimizer' && <OptimizerTab optimization={optimization} />}

          {tab === 'waitlist' && (
            <div>
              {(waitlist?.pendingOffers?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <div className="section-label mb-2">Ofertas pendentes</div>
                  <div className="card" style={{ padding: 0 }}>
                    <div className="table-scroll">
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th className="data-th">Doente</th>
                            <th className="data-th">Tratamento</th>
                            <th className="data-th">Horário oferecido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(waitlist?.pendingOffers || []).map((o) => (
                            <tr key={o.id} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                              <td className="data-td" style={{ fontWeight: 600 }}>
                                {o.patient_name || '—'}
                              </td>
                              <td className="data-td">{o.treatment_type}</td>
                              <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                                {String(o.offered_date).slice(0, 10)} · {String(o.offered_start_time).slice(0, 5)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="section-label mb-2">Lista de espera</div>
              {!waitlist?.entries?.length ? (
                <Empty message="Sem doentes na lista de espera." />
              ) : (
                <div className="card" style={{ padding: 0 }}>
                  <div className="table-scroll">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th className="data-th">Doente</th>
                          <th className="data-th">Tratamento</th>
                          <th className="data-th">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitlist.entries.map((w) => (
                          <tr key={w.id} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                            <td className="data-td" style={{ fontWeight: 600 }}>
                              {w.patient_name}
                            </td>
                            <td className="data-td">{w.treatment_type}</td>
                            <td className="data-td">
                              <Badge
                                label={WAITLIST_STATUS_LABEL[w.status] || w.status}
                                bg="var(--bg-sunken)"
                                color="var(--text-secondary)"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
