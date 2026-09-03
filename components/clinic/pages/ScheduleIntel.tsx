'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import EfficiencyTab from '@/components/receptionist/EfficiencyTab';
import OptimizerTab from '@/components/receptionist/OptimizerTab';
import { Badge, Empty, GhostBtn, PageHeader, RiskBadge, Spinner, Tabs } from '@/components/ui';
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
  if (rate >= 0.4) return { bg: 'var(--red-bg)', color: 'var(--red)' };
  if (rate >= 0.2) return { bg: 'var(--amber-bg)', color: 'var(--amber)' };
  if (rate > 0) return { bg: 'var(--green-bg)', color: 'var(--green)' };
  return { bg: 'var(--surface-2)', color: 'var(--ink-3)' };
}

// Agenda inteligente da própria clínica. A versão de plataforma
// (components/super-admin/pages/ScheduleIntel.tsx) escolhe o tenant primeiro; aqui as rotas
// /schedule-intel/* e /waitlist já confinam tudo a user.tenantId, por isso não se passa
// ?tenantId= e a página carrega direta.
export default function ClinicScheduleIntelPage() {
  const { api } = useAuth();
  const [tab, setTab] = useState('risk');

  const [risk, setRisk] = useState<RiskData | null>(null);
  const [heatmap, setHeatmap] = useState<RiskHeatmapData | null>(null);
  const [efficiency, setEfficiency] = useState<AgendaEfficiency | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistData | null>(null);
  const [optimization, setOptimization] = useState<ScheduleOptimization | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    const [r, h, e, w, o] = await Promise.all([
      api('/schedule-intel/risk?days=14').catch((err) => {
        setErr(err instanceof Error ? err.message : 'Falha ao carregar');
        return null;
      }),
      api('/schedule-intel/heatmap').catch(() => null),
      api('/schedule-intel/efficiency?days=14').catch(() => null),
      api('/waitlist').catch(() => null),
      api('/schedule-intel/optimizer?days=14').catch(() => null),
    ]);
    setRisk(r);
    setHeatmap(h);
    setEfficiency(e);
    setWaitlist(w);
    setOptimization(o);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

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

      {err && (
        <div
          className="card p-4 mb-4"
          style={{ border: '1px solid #FFBDAD', background: '#FFEBE6', color: '#DE350B', fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      {loading ? (
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
              { key: 'waitlist', label: 'Lista de Espera', count: waitlist?.pendingOffers?.length || undefined },
            ]}
          />

          {tab === 'risk' &&
            (!risk?.appointments?.length ? (
              <Empty message="Sem consultas nos próximos 14 dias." />
            ) : (
              <div className="card" style={{ padding: 0 }}>
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
                      <tr key={a.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
                        <td className="data-td" style={{ fontWeight: 600 }}>
                          {a.patient_name}
                        </td>
                        <td className="data-td">{a.phone ? formatPhonePT(a.phone) : '—'}</td>
                        <td className="data-td" style={{ color: 'var(--ink-2)' }}>
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
            ))}

          {tab === 'heatmap' &&
            (!heatmap?.cells?.length ? (
              <Empty message="Ainda sem histórico suficiente (faltas/cancelamentos) para calcular o heatmap." />
            ) : (
              <div className="card p-5">
                <p className="text-sm mb-4" style={{ color: 'var(--ink-2)' }}>
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
                                    borderRadius: 6,
                                    padding: '8px 4px',
                                    fontWeight: 700,
                                    fontSize: 13,
                                  }}
                                >
                                  {cell?.total ? `${Math.round(rate * 100)}%` : '—'}
                                </div>
                                {cell?.total ? (
                                  <div className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
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
                          <tr key={o.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
                            <td className="data-td" style={{ fontWeight: 600 }}>
                              {o.patient_name || '—'}
                            </td>
                            <td className="data-td">{o.treatment_type}</td>
                            <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                              {String(o.offered_date).slice(0, 10)} · {String(o.offered_start_time).slice(0, 5)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="section-label mb-2">Lista de espera</div>
              {!waitlist?.entries?.length ? (
                <Empty message="Sem doentes na lista de espera." />
              ) : (
                <div className="card" style={{ padding: 0 }}>
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
                        <tr key={w.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
                          <td className="data-td" style={{ fontWeight: 600 }}>
                            {w.patient_name}
                          </td>
                          <td className="data-td">{w.treatment_type}</td>
                          <td className="data-td">
                            <Badge
                              label={WAITLIST_STATUS_LABEL[w.status] || w.status}
                              bg="var(--surface-2)"
                              color="var(--ink-2)"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
