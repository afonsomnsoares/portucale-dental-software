'use client';
import Link from 'next/link';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, Inp, MetricCard, PageHeader, PrimaryBtn, Sel, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';
import type { ClinicComparison, ReportInsight, ReportSummary, Tenant } from '@/lib/types';

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

function trend(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  const sign = v > 0 ? '+' : '';
  return `${sign}${Math.round(v * 1000) / 10}% vs. período anterior`;
}

// ─── Um só ecrã de relatórios, dois âmbitos ─────────────────────────────────
// Eram duas cópias com 192 de 218 linhas iguais. A de plataforma é a de clínica
// mais um bloco: a comparação entre clínicas, que só faz sentido para quem vê
// mais do que uma. Esse bloco já estava guardado por `isGlobalAdmin` — o que
// faltava era o resto do ecrã funcionar para quem tem clínica própria, e não
// funcionava: pedia GET /api/tenants (403 para um admin de clínica) e ficava à
// espera de um tenantId que nunca chegava.
export default function Reports() {
  const { api, user } = useAuth();
  // Quem tem clínica própria vê a sua e não escolhe; o super-admin escolhe e, só
  // ele, compara.
  const ownTenantId = user?.tenantId || '';
  const isGlobalAdmin = !ownTenantId;
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState(ownTenantId);
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [comparison, setComparison] = useState<ClinicComparison | null>(null);
  const [err, setErr] = useState('');
  const [insight, setInsight] = useState<ReportInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightScope, setInsightScope] = useState<'clinic' | 'compare'>('clinic');

  useEffect(() => {
    if (ownTenantId) return;
    api('/tenants')
      .then((t) => {
        setTenants(t || []);
        if ((t || []).length) setTenantId(t[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, ownTenantId]);

  const load = useCallback(async () => {
    if (!tenantId && !ownTenantId) return;
    setErr('');
    setInsight(null);
    // Quem tem clínica própria omite o tenantId e deixa o servidor forçá-lo.
    const params = new URLSearchParams(tenantId ? { tenantId, from, to } : { from, to });
    const [summary, cmp] = await Promise.all([
      api(`/reports/summary?${params.toString()}`).catch((e) => {
        setErr(e instanceof Error ? e.message : 'Falha ao carregar');
        return null;
      }),
      isGlobalAdmin ? api(`/reports/compare?from=${from}&to=${to}`).catch(() => null) : Promise.resolve(null),
    ]);
    setData(summary);
    setComparison(cmp);
  }, [api, tenantId, ownTenantId, from, to, isGlobalAdmin]);

  useEffect(() => {
    if (tenantId || ownTenantId) load();
  }, [tenantId, ownTenantId, load]);

  async function generateInsight(scope: 'clinic' | 'compare') {
    setInsightScope(scope);
    setInsightLoading(true);
    setInsight(null);
    const body = scope === 'clinic' ? { tenantId, from, to } : { from, to };
    const res = await api('/reports/insight', { method: 'POST', body }).catch((e) => ({
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
        {isGlobalAdmin &&
          (loading ? (
            <Spinner />
          ) : (
            <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 280 }}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Sel>
          ))}
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
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: 'var(--text-muted)' }}>Sem dados para o período.</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard
              label="Receita"
              value={formatEUR(data.metrics.completedValue)}
              sub={trend(data.previous.revenueTrend) || `${data.range.from} → ${data.range.to}`}
              color="var(--accent)"
            />
            <MetricCard
              label="Ocupação"
              value={pct(data.metrics.chairUtilization)}
              sub={`${data.tenant.operatories} cadeira(s) · ${data.metrics.chairMinutes} min`}
              color="var(--urgency-ok)"
            />
            <MetricCard
              label="No-show"
              value={pct(data.metrics.noShowRate)}
              sub={
                trend(data.previous.noShowTrend) ||
                `${data.metrics.noShows} / ${data.metrics.appointmentsTotal} consultas`
              }
              color="var(--urgency-critical)"
            />
            <MetricCard
              label="Novos Pacientes"
              value={data.metrics.newPatients}
              sub="no período"
              color="var(--cat-teal)"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard
              label="Planos Apresentados"
              value={formatEUR(data.metrics.presentedValue)}
              color="var(--urgency-soon)"
            />
            <MetricCard label="Planos Aceites" value={formatEUR(data.metrics.acceptedValue)} color="var(--accent)" />
            <MetricCard
              label="Taxa de Conversão de Planos"
              value={pct(data.metrics.planConversionRate)}
              sub={trend(data.previous.conversionTrend) || undefined}
              color="var(--urgency-ok)"
            />
            <MetricCard
              label="Receita Potencial Perdida"
              value={formatEUR(data.metrics.recoveryPotential)}
              sub={
                <Link href={isGlobalAdmin ? '/dashboard/super-admin/recovery' : '/dashboard/admin/recovery'}>
                  Ver detalhe em Recuperação →
                </Link>
              }
              color="var(--urgency-critical)"
            />
          </div>

          {data.dailyRevenue.length > 0 && (
            <div className="card p-5 mb-4">
              <div className="section-label mb-3">Receita diária no período</div>
              {data.dailyRevenue.map((d) => (
                <div key={d.day} className="flex items-center gap-3 mb-2">
                  <span className="text-xs" style={{ width: 90, color: 'var(--text-secondary)' }}>
                    {d.day.slice(0, 10)}
                  </span>
                  <div
                    style={{ flex: 1, height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)' }}
                  >
                    <div
                      style={{
                        width: `${(Number(d.revenue) / maxDailyRevenue) * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 'var(--radius-control)',
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

          {isGlobalAdmin && comparison && comparison.clinics.length > 1 && (
            <div className="card p-5 mb-4">
              <div className="section-label mb-3">Comparar Clínicas</div>
              {comparison.gap && (
                <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Diferença de conversão entre a melhor e a pior clínica: cerca de{' '}
                  <strong style={{ color: 'var(--urgency-critical)' }}>{formatEUR(comparison.gap.valueDiff)}</strong> em
                  planos não convertidos.
                </p>
              )}
              <div className="overflow-x-auto">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th className="data-th">Clínica</th>
                      <th className="data-th" style={{ textAlign: 'right' }}>
                        Receita
                      </th>
                      <th className="data-th" style={{ textAlign: 'right' }}>
                        Conversão de Planos
                      </th>
                      <th className="data-th" style={{ textAlign: 'right' }}>
                        No-show
                      </th>
                      <th className="data-th" style={{ textAlign: 'right' }}>
                        Ocupação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.clinics.map((c) => (
                      <tr key={c.tenantId} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                        <td className="data-td" style={{ fontWeight: 600 }}>
                          {c.name}
                          {c.tenantId === comparison.gap?.bestTenantId && (
                            <span
                              className="badge ml-2"
                              style={{ background: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' }}
                            >
                              melhor conversão
                            </span>
                          )}
                          {c.tenantId === comparison.gap?.worstTenantId && (
                            <span
                              className="badge ml-2"
                              style={{ background: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' }}
                            >
                              pior conversão
                            </span>
                          )}
                        </td>
                        <td className="data-td" style={{ textAlign: 'right' }}>
                          {formatEUR(c.revenue)}
                        </td>
                        <td className="data-td" style={{ textAlign: 'right', fontWeight: 700 }}>
                          {pct(c.conversionRate)}
                        </td>
                        <td className="data-td" style={{ textAlign: 'right' }}>
                          {pct(c.noShowRate)}
                        </td>
                        <td className="data-td" style={{ textAlign: 'right' }}>
                          {pct(c.chairUtilization)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="section-label">Análise IA</div>
              <div className="flex gap-2">
                <PrimaryBtn
                  disabled={insightLoading}
                  onClick={() => generateInsight('clinic')}
                  style={{ padding: '6px 12px' }}
                >
                  {insightLoading && insightScope === 'clinic' ? 'A gerar…' : 'Gerar análise desta clínica'}
                </PrimaryBtn>
                {isGlobalAdmin && comparison && comparison.clinics.length > 1 && (
                  <GhostBtn
                    disabled={insightLoading}
                    onClick={() => generateInsight('compare')}
                    style={{ padding: '6px 12px' }}
                  >
                    {insightLoading && insightScope === 'compare' ? 'A gerar…' : 'Comparar clínicas'}
                  </GhostBtn>
                )}
              </div>
            </div>
            {insightLoading ? (
              <Spinner />
            ) : !insight ? (
              <Empty message="Carrega em 'Gerar análise' para obter um diagnóstico do período." />
            ) : insight.configured === false ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Análise por IA não configurada — defina <code>ANTHROPIC_API_KEY</code> no servidor para ativar esta
                funcionalidade.
              </p>
            ) : insight.error ? (
              <p className="text-sm" style={{ color: 'var(--urgency-critical)' }}>
                {insight.error}
              </p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
                {insight.insight}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
