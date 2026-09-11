'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, MetricCard, PageHeader, Sel, Spinner } from '@/components/ui';
import { formatEUR, formatPhonePT } from '@/lib/constants';
import type { RecoveryCategory, RecoveryData, RecoveryItem } from '@/lib/types';

interface RecoveryRow extends RecoveryItem {
  categoryKey: string;
  categoryLabel: string;
  action: string;
}

const CATEGORY_ROUTES: Record<string, string> = {
  proposed_treatments: '/dashboard/receptionist/treatments',
  accepted_open: '/dashboard/receptionist/treatments',
  plans_pending_decision: '/dashboard/receptionist/treatments',
  plans_not_started: '/dashboard/receptionist/treatments',
  never_booked: '/dashboard/receptionist/appointments',
  inactive_patients: '/dashboard/receptionist/appointments',
  no_shows_90d: '/dashboard/receptionist/appointments',
  cancelled_90d: '/dashboard/receptionist/appointments',
  unbooked_leads: '/dashboard/receptionist/patients',
  empty_slots: '/dashboard/receptionist/appointments',
  outstanding_balance: '/dashboard/receptionist/invoices',
};

// The three headline numbers requested for this view: pending decision, abandoned
// (accepted but nobody's chasing it), and accepted-but-not-started. Pulled out of
// whichever categories currently represent each — kept as a lookup instead of hardcoding
// key names inline at each call site.
function sumCategories(categories: RecoveryCategory[], keys: string[]) {
  return categories.filter((c) => keys.includes(c.key)).reduce((acc, c) => acc + c.estimatedValue, 0);
}

export default function RecoveryReceptionistPage() {
  const { api } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tasksCreated, setTasksCreated] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setErr('');
    const res = await api('/recovery').catch((e) => {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar');
      return null;
    });
    setData(res);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const all: RecoveryRow[] = [];
    for (const c of data.categories) {
      for (const i of c.items) {
        all.push({ ...i, categoryKey: c.key, categoryLabel: c.label, action: c.action });
      }
    }
    return all.sort((a, b) => Number(b.value) - Number(a.value));
  }, [data]);

  const filtered = catFilter === 'all' ? rows : rows.filter((r) => r.categoryKey === catFilter);

  function openSchedule(row: RecoveryRow) {
    const query = row.patient_id ? `?patientId=${encodeURIComponent(row.patient_id)}` : '';
    router.push(`/dashboard/receptionist/appointments${query}`);
  }

  async function completeRecall(row: RecoveryRow) {
    if (!row.id) return;
    setBusyId(row.id);
    setErr('');
    try {
      await api(`/recalls/${row.id}`, { method: 'PUT', body: { complete: true } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível marcar este recall como feito.');
    }
    setBusyId(null);
    load();
  }

  function rowKey(r: RecoveryRow) {
    return `${r.categoryKey}-${r.patient_id || r.id}`;
  }

  async function createFollowUp(row: RecoveryRow) {
    if (!row.patient_id) return;
    const key = rowKey(row);
    setBusyId(key);
    setErr('');
    try {
      await api('/patient-tasks', {
        method: 'POST',
        body: {
          patientId: row.patient_id,
          type: 'follow_up',
          title: `Follow-up: ${row.categoryLabel} — ${row.patient_name}`,
          notes: row.detail,
        },
      });
      setTasksCreated((prev) => new Set(prev).add(key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível criar a tarefa de follow-up.');
    }
    setBusyId(null);
  }

  return (
    <div>
      <PageHeader title="Lista de Recuperação" sub="Oportunidades de receita — ligue ao doente certo hoje">
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
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : !data ? (
        <Empty message="Sem dados disponíveis." />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }} className="mb-4">
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

          <div className="card p-4 mb-4 flex items-center gap-4 flex-wrap">
            <span className="section-label">Receita potencial total</span>
            <strong style={{ fontSize: 20, color: 'var(--urgency-ok)' }}>{formatEUR(data.total)}</strong>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {rows.length} contactos na lista
            </span>
            <div style={{ marginLeft: 'auto' }}>
              <Sel value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ minWidth: 220 }}>
                <option value="all">Todas as categorias</option>
                {data.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({c.count})
                  </option>
                ))}
              </Sel>
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty message="Sem oportunidades nesta categoria." />
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="data-th">Doente</th>
                    <th className="data-th">Contacto</th>
                    <th className="data-th">Motivo</th>
                    <th className="data-th">Categoria</th>
                    <th className="data-th" style={{ textAlign: 'right' }}>
                      Valor
                    </th>
                    <th className="data-th" style={{ textAlign: 'right' }}>
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={rowKey(r)} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {r.patient_name}
                      </td>
                      <td className="data-td">
                        <div>{r.phone ? <a href={`tel:${r.phone}`}>{formatPhonePT(r.phone)}</a> : '—'}</div>
                        {r.email && (
                          <a href={`mailto:${r.email}`} className="text-xs" style={{ color: 'var(--accent)' }}>
                            {r.email}
                          </a>
                        )}
                      </td>
                      <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                        {r.detail}
                        {r.daysSince != null && r.daysSince >= 14 && (
                          <span
                            className="badge ml-2"
                            style={{
                              background: 'var(--urgency-critical-bg)',
                              color: 'var(--urgency-critical)',
                              fontSize: 10,
                            }}
                          >
                            atrasado
                          </span>
                        )}
                      </td>
                      <td className="data-td">
                        <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          {r.categoryLabel}
                        </span>
                      </td>
                      <td className="data-td" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatEUR(r.value)}
                      </td>
                      <td className="data-td" style={{ textAlign: 'right' }}>
                        {r.categoryKey === 'recalls_overdue' ? (
                          <GhostBtn
                            disabled={busyId === r.id}
                            onClick={() => completeRecall(r)}
                            style={{ padding: '5px 10px' }}
                          >
                            {busyId === r.id ? '…' : 'Concluir recall'}
                          </GhostBtn>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            {r.patient_id &&
                              (tasksCreated.has(rowKey(r)) ? (
                                <span className="text-xs" style={{ color: 'var(--urgency-ok)', fontWeight: 700 }}>
                                  Tarefa criada
                                </span>
                              ) : (
                                <GhostBtn
                                  disabled={busyId === rowKey(r)}
                                  onClick={() => createFollowUp(r)}
                                  style={{ padding: '5px 10px' }}
                                >
                                  {busyId === rowKey(r) ? '…' : 'Criar tarefa'}
                                </GhostBtn>
                              ))}
                            {(r.phone || r.email) && (
                              <GhostBtn
                                onClick={() => {
                                  window.location.href = r.phone ? `tel:${r.phone}` : `mailto:${r.email}`;
                                }}
                                style={{ padding: '5px 10px' }}
                              >
                                Contactar
                              </GhostBtn>
                            )}
                            {[
                              'never_booked',
                              'inactive_patients',
                              'no_shows_90d',
                              'cancelled_90d',
                              'unbooked_leads',
                            ].includes(r.categoryKey) ? (
                              <GhostBtn onClick={() => openSchedule(r)} style={{ padding: '5px 10px' }}>
                                Agendar
                              </GhostBtn>
                            ) : (
                              <GhostBtn
                                onClick={() => router.push(CATEGORY_ROUTES[r.categoryKey] || '/dashboard/receptionist')}
                                style={{ padding: '5px 10px' }}
                              >
                                Abrir
                              </GhostBtn>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
