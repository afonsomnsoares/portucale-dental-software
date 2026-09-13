'use client';
import { useState } from 'react';
import { Empty, GhostBtn, MetricCard, Modal, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';
import type { RecoveryCategory, RecoveryData } from '@/lib/types';

function sumCategories(categories: RecoveryCategory[], keys: string[]) {
  return categories.filter((c) => keys.includes(c.key)).reduce((acc, c) => acc + c.estimatedValue, 0);
}

// Recuperação de receita da própria clínica. Ao contrário da versão de plataforma
// (components/super-admin/pages/Recovery.tsx), não há seletor: app/api/recovery/route.ts só
// aceita ?tenantId= de um super_admin e confina toda a gente ao seu user.tenantId.
export default function ClinicRecoveryPage({ initialData }: { initialData?: RecoveryData } = {}) {
  const [openCat, setOpenCat] = useState<RecoveryCategory | null>(null);
  const consulta = useQuery<RecoveryData>('/recovery', { initialData });
  const data = consulta.data ?? null;
  const loading = consulta.loading;
  const err = consulta.error?.message ?? '';
  const load = consulta.refetch;

  const maxSnap = Math.max(1, ...(data?.snapshots || []).map((s) => Number(s.total_estimated)));

  return (
    <div>
      <PageHeader title="Recuperação de Receita" sub="Receita potencial identificada nos dados da clínica">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4"
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 'var(--weight-bold)',
          }}
        >
          {err}
        </div>
      )}

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: 'var(--text-muted)' }}>Sem dados de recuperação.</div>}
        </div>
      ) : (
        <>
          <div className="grid-cards mb-4" style={{ gap: 16 }}>
            <MetricCard
              label="Pendentes de decisão"
              value={formatEUR(sumCategories(data.categories, ['proposed_treatments', 'plans_pending_decision']))}
              sub="Orçamentos e planos apresentados, sem resposta do doente"
              color="var(--urgency-soon)"
            />
            <MetricCard
              label="Abandonados"
              value={formatEUR(sumCategories(data.categories, ['accepted_open']))}
              sub="Aceites, sem próxima consulta marcada"
              color="var(--urgency-critical)"
            />
            <MetricCard
              label="Por iniciar"
              value={formatEUR(sumCategories(data.categories, ['plans_not_started']))}
              sub="Planos aceites, tratamento ainda não começou"
              color="var(--accent)"
            />
          </div>

          <div
            className="card p-6 mb-4 flex items-center justify-between flex-wrap gap-4"
            style={{ borderLeft: '4px solid var(--urgency-ok)' }}
          >
            <div>
              <div className="section-label mb-2">Receita potencial identificada</div>
              <div
                style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 'var(--weight-bold)',
                  color: 'var(--urgency-ok)',
                  lineHeight: 'var(--text-3xl-leading)',
                }}
              >
                {formatEUR(data.total)}
              </div>
              <div className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                {data.categories.reduce((a, c) => a + c.count, 0)} oportunidades em {data.categories.length} categorias
              </div>
            </div>
            <div className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>
              Calculado a {new Date(data.generatedAt).toLocaleString('pt-PT')}
            </div>
          </div>

          {data.snapshots?.length > 0 && (
            <div className="card p-5 mb-4">
              <div className="section-label mb-3">Evolução mensal (snapshots)</div>
              {[...data.snapshots].reverse().map((s) => (
                <div key={s.snapshot_month} className="flex items-center gap-3 mb-2">
                  <span className="text-xs" style={{ width: 80, color: 'var(--text-secondary)' }}>
                    {String(s.snapshot_month).slice(0, 7)}
                  </span>
                  <div
                    style={{ flex: 1, height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)' }}
                  >
                    <div
                      style={{
                        width: `${(Number(s.total_estimated) / maxSnap) * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 'var(--radius-control)',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 110,
                      textAlign: 'right',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-bold)',
                    }}
                  >
                    {formatEUR(Number(s.total_estimated))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid-cards" style={{ gap: 16 }}>
            {data.categories.map((c) => (
              <button
                type="button"
                key={c.key}
                className="card p-5 cursor-pointer"
                onClick={() => setOpenCat(c)}
                style={{
                  borderLeft: `4px solid ${c.count > 0 ? 'var(--urgency-soon)' : 'var(--border-subtle)'}`,
                  textAlign: 'left',
                  width: '100%',
                  display: 'block',
                  fontFamily: 'inherit',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="section-label mb-1">{c.label}</div>
                    <div
                      style={{
                        fontSize: 'var(--text-xl)',
                        fontWeight: 'var(--weight-bold)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {formatEUR(c.estimatedValue)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {c.description}
                    </div>
                  </div>
                  <span
                    className="badge flex-shrink-0"
                    style={{
                      background: c.count > 0 ? 'var(--accent-bg)' : 'var(--bg-sunken)',
                      color: c.count > 0 ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {c.count}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {openCat && (
            <Modal
              title={`${openCat.label} — ${formatEUR(openCat.estimatedValue)}`}
              onClose={() => setOpenCat(null)}
              width={720}
            >
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {openCat.description} <strong>Ação sugerida:</strong> {openCat.action}
              </p>
              {openCat.items.length === 0 ? (
                <Empty message="Sem itens detalhados para esta categoria." />
              ) : (
                <div className="overflow-x-auto">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th className="data-th">Doente</th>
                        <th className="data-th">Contacto</th>
                        <th className="data-th">Detalhe</th>
                        <th className="data-th" style={{ textAlign: 'right' }}>
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {openCat.items.map((i) => (
                        <tr key={i.patient_id || i.id}>
                          <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                            {i.patient_name}
                          </td>
                          <td className="data-td">{i.phone || '—'}</td>
                          <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                            {i.detail}
                          </td>
                          <td className="data-td" style={{ textAlign: 'right', fontWeight: 'var(--weight-bold)' }}>
                            {formatEUR(i.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
