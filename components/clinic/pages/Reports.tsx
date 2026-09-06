'use client';
import Link from 'next/link';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, Inp, MetricCard, PageHeader, PrimaryBtn, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';
import type { ReportInsight, ReportSummary } from '@/lib/types';

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

function trend(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  const sign = v > 0 ? '+' : '';
  return `${sign}${Math.round(v * 1000) / 10}% vs. período anterior`;
}

// Relatórios da própria clínica. A versão de plataforma
// (components/super-admin/pages/Reports.tsx) escolhe o tenant e mostra o quadro comparativo
// entre clínicas (/reports/compare); nada disso se aplica aqui — /reports/summary já usa
// user.tenantId para quem não é super_admin, e comparar clínicas é trabalho de
// plataforma. Como esta cópia só monta em /dashboard/admin, o link para Recuperação é
// fixo em vez de passar pelo basePathFor.
export default function ClinicReportsPage() {
  const { api } = useAuth();
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [err, setErr] = useState('');
  const [insight, setInsight] = useState<ReportInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    setInsight(null);
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    const summary = await api(`/reports/summary?${params.toString()}`).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar');
      return null;
    });
    setData(summary);
    setLoading(false);
  }, [api, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateInsight() {
    setInsightLoading(true);
    setInsight(null);
    const res = await api('/reports/insight', { method: 'POST', body: { from, to } }).catch((e) => ({
      insight: null,
      configured: true,
      error: e instanceof Error ? e.message : 'Falha ao gerar análise',
    }));
    setInsight(res);
    setInsightLoading(false);
  }

  const maxDailyRevenue = Math.max(1, ...(data?.dailyRevenue || []).map((d) => Number(d.revenue)));

  return (
    <div>
      <PageHeader title="Relatórios" sub="Desempenho da clínica — receita, funil de conversão e eficiência">
        <Inp
          type="date"
          value={from}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
          style={{ width: 'auto' }}
        />
        <Inp
          type="date"
          value={to}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
          style={{ width: 'auto' }}
        />
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

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: '#97A0AF' }}>Sem dados para este período.</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard
              label="Receita"
              value={formatEUR(data.metrics.completedValue)}
              sub={trend(data.previous.revenueTrend) || `${data.range.from} → ${data.range.to}`}
              color="var(--brand)"
            />
            <MetricCard
              label="Ocupação"
              value={pct(data.metrics.chairUtilization)}
              sub={`${data.tenant.operatories} cadeira(s) · ${data.metrics.chairMinutes} min`}
              color="var(--green)"
            />
            <MetricCard
              label="No-show"
              value={pct(data.metrics.noShowRate)}
              sub={
                trend(data.previous.noShowTrend) ||
                `${data.metrics.noShows} / ${data.metrics.appointmentsTotal} consultas`
              }
              color="var(--red)"
            />
            <MetricCard label="Novos Pacientes" value={data.metrics.newPatients} sub="no período" color="var(--teal)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard
              label="Planos Apresentados"
              value={formatEUR(data.metrics.presentedValue)}
              color="var(--amber)"
            />
            <MetricCard label="Planos Aceites" value={formatEUR(data.metrics.acceptedValue)} color="var(--brand)" />
            <MetricCard
              label="Taxa de Conversão de Planos"
              value={pct(data.metrics.planConversionRate)}
              sub={trend(data.previous.conversionTrend) || undefined}
              color="var(--green)"
            />
            <MetricCard
              label="Receita Potencial Perdida"
              value={formatEUR(data.metrics.recoveryPotential)}
              sub={<Link href="/dashboard/admin/recovery">Ver detalhe em Recuperação →</Link>}
              color="var(--red)"
            />
          </div>

          {data.dailyRevenue.length > 0 && (
            <div className="card p-5 mb-4">
              <div className="section-label mb-3">Receita diária no período</div>
              {data.dailyRevenue.map((d) => (
                <div key={d.day} className="flex items-center gap-3 mb-2">
                  <span className="text-xs" style={{ width: 90, color: 'var(--ink-2)' }}>
                    {d.day.slice(0, 10)}
                  </span>
                  <div style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
                    <div
                      style={{
                        width: `${(Number(d.revenue) / maxDailyRevenue) * 100}%`,
                        height: '100%',
                        background: 'var(--brand)',
                        borderRadius: 5,
                      }}
                    />
                  </div>
                  <span style={{ width: 100, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                    {formatEUR(Number(d.revenue))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="section-label">Análise IA</div>
              <div className="flex gap-2">
                <PrimaryBtn disabled={insightLoading} onClick={generateInsight} style={{ padding: '6px 12px' }}>
                  {insightLoading ? 'A gerar…' : 'Gerar análise do período'}
                </PrimaryBtn>
              </div>
            </div>
            {insightLoading ? (
              <Spinner />
            ) : !insight ? (
              <Empty message="Carrega em 'Gerar análise' para obter um diagnóstico do período." />
            ) : insight.configured === false ? (
              <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                Análise por IA não configurada — defina <code>ANTHROPIC_API_KEY</code> no servidor para ativar esta
                funcionalidade.
              </p>
            ) : insight.error ? (
              <p className="text-sm" style={{ color: 'var(--red)' }}>
                {insight.error}
              </p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--ink)', lineHeight: 1.6 }}>
                {insight.insight}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
