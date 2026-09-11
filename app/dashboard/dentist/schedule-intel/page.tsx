'use client';
import { useAuth } from '@/app/providers';
import { Empty, ErrorState, PageHeader, RiskBadge, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Appointment } from '@/lib/types';

export default function DentistScheduleIntelPage() {
  const { user } = useAuth();
  const riskQuery = useQuery<Appointment[]>('/schedule-intel/risk?days=14');
  const schedQuery = useQuery<Appointment[]>('/appointments?from=&to=');

  // Todo o cálculo abaixo era feito dentro do efeito e guardado em três estados.
  // É derivação pura das duas respostas — deriva-se no render e deixa de haver
  // estado para ficar dessincronizado.
  const riskAll = riskQuery.data ?? [];
  const myAppts = (schedQuery.data ?? []).filter((a) => a.dentist_id === user?.id);
  const highRiskAppts = riskAll.filter((a) => (a.risk_score || 0) >= 60);
  const upcomingAppts = myAppts.filter((a) => ['confirmed', 'registered', 'waiting'].includes(a.status)).slice(0, 10);
  const noShowData = {
    total: myAppts.length,
    noShow: myAppts.filter((a) => a.status === 'no-show').length,
  };

  return (
    <div>
      <PageHeader title="Inteligência de Agenda" sub="Visão do risco de falta e ocupação" />
      {schedQuery.error ? (
        <ErrorState error={schedQuery.error} onRetry={schedQuery.refetch} message="Não foi possível ler a agenda." />
      ) : schedQuery.loading ? (
        <Spinner />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
              <div className="section-label">Consultas Agendadas</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>{upcomingAppts.length}</div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid var(--urgency-critical)' }}>
              <div className="section-label">Risco Alto (≥60%)</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--urgency-critical)' }}>
                {highRiskAppts.length}
              </div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid var(--urgency-soon)' }}>
              <div className="section-label">Taxa de No-Show</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--urgency-soon)' }}>
                {noShowData.total > 0 ? Math.round((noShowData.noShow / noShowData.total) * 100) : 0}%
              </div>
            </div>
          </div>

          {highRiskAppts.length > 0 && (
            <div className="mt-5">
              <h3 style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)', marginBottom: 10 }}>
                Consultas de Risco Elevado — Próximos 14 dias
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th className="data-th">Doente</th>
                      <th className="data-th">Contacto</th>
                      <th className="data-th">Consulta</th>
                      <th className="data-th">Risco</th>
                      <th className="data-th" style={{ textAlign: 'right' }}>
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {highRiskAppts.map((a) => (
                      <tr key={a.id}>
                        <td className="data-td">{a.patient_name}</td>
                        <td className="data-td">
                          {a.appt_date} {a.start_time?.slice(0, 5)}
                        </td>
                        <td className="data-td">
                          <RiskBadge score={a.risk_score || 0} />
                        </td>
                        <td className="data-td" style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '4px 12px', fontSize: 12 }}
                          >
                            Confirmar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {upcomingAppts.length === 0 && highRiskAppts.length === 0 && (
            <Empty message="Sem consultas agendadas para os próximos dias." />
          )}
        </>
      )}
    </div>
  );
}
