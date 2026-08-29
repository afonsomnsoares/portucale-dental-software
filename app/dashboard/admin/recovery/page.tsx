'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, Modal, PageHeader, Sel, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';
import type { RecoveryCategory, RecoveryData, Tenant } from '@/lib/types';

export default function RecoveryAdminPage() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RecoveryData | null>(null);
  const [err, setErr] = useState('');
  const [openCat, setOpenCat] = useState<RecoveryCategory | null>(null);

  useEffect(() => {
    api('/tenants')
      .then((t) => {
        setTenants(t || []);
        if ((t || []).length) setTenantId(t[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setErr('');
    const res = await api(`/recovery?tenantId=${tenantId}`).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar');
      return null;
    });
    setData(res);
  }, [api, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const maxSnap = Math.max(1, ...(data?.snapshots || []).map((s) => Number(s.total_estimated)));

  return (
    <div>
      <PageHeader title="Recuperação de Receita" sub="Receita potencial identificada nos dados da clínica">
        {loading ? (
          <Spinner />
        ) : (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 320 }}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Sel>
        )}
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4"
          style={{ border: '1px solid #FFBDAD', background: '#FFEBE6', color: '#DE350B', fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: '#97A0AF' }}>Selecione uma clínica.</div>}
        </div>
      ) : (
        <>
          <div
            className="card p-6 mb-4 flex items-center justify-between flex-wrap gap-4"
            style={{ borderLeft: '4px solid var(--green)' }}
          >
            <div>
              <div className="section-label mb-2">Receita potencial identificada</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>
                {formatEUR(data.total)}
              </div>
              <div className="text-sm mt-2" style={{ color: 'var(--ink-2)' }}>
                {data.tenant.name} · {data.categories.reduce((a, c) => a + c.count, 0)} oportunidades em{' '}
                {data.categories.length} categorias
              </div>
            </div>
            <div className="text-xs text-right" style={{ color: 'var(--ink-3)' }}>
              Calculado a {new Date(data.generatedAt).toLocaleString('pt-PT')}
            </div>
          </div>

          {data.snapshots?.length > 0 && (
            <div className="card p-5 mb-4">
              <div className="section-label mb-3">Evolução mensal (snapshots)</div>
              {[...data.snapshots].reverse().map((s) => (
                <div key={s.snapshot_month} className="flex items-center gap-3 mb-2">
                  <span className="text-xs" style={{ width: 80, color: 'var(--ink-2)' }}>
                    {String(s.snapshot_month).slice(0, 7)}
                  </span>
                  <div style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
                    <div
                      style={{
                        width: `${(Number(s.total_estimated) / maxSnap) * 100}%`,
                        height: '100%',
                        background: 'var(--brand)',
                        borderRadius: 5,
                      }}
                    />
                  </div>
                  <span style={{ width: 110, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                    {formatEUR(Number(s.total_estimated))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {data.categories.map((c) => (
              <button
                type="button"
                key={c.key}
                className="card p-5 cursor-pointer"
                onClick={() => setOpenCat(c)}
                style={{
                  borderLeft: `4px solid ${c.count > 0 ? 'var(--amber)' : 'var(--border)'}`,
                  textAlign: 'left',
                  width: '100%',
                  display: 'block',
                  fontFamily: 'inherit',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="section-label mb-1">{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>
                      {formatEUR(c.estimatedValue)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
                      {c.description}
                    </div>
                  </div>
                  <span
                    className="badge flex-shrink-0"
                    style={{
                      background: c.count > 0 ? 'var(--brand-bg)' : 'var(--surface-2)',
                      color: c.count > 0 ? 'var(--brand)' : 'var(--ink-3)',
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
              <p className="text-sm mb-4" style={{ color: 'var(--ink-2)' }}>
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
                          <td className="data-td" style={{ fontWeight: 600 }}>
                            {i.patient_name}
                          </td>
                          <td className="data-td">{i.phone || '—'}</td>
                          <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                            {i.detail}
                          </td>
                          <td className="data-td" style={{ textAlign: 'right', fontWeight: 700 }}>
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
