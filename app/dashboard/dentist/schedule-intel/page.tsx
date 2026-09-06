'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, PageHeader, RiskBadge, Spinner } from '@/components/ui';
import type { Appointment } from '@/lib/types';

export default function DentistScheduleIntelPage() {
  const { api, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [highRiskAppts, setHighRiskAppts] = useState<Appointment[]>([]);
  const [upcomingAppts, setUpcomingAppts] = useState<Appointment[]>([]);
  const [noShowData, setNoShowData] = useState<{ total: number; noShow: number }>({ total: 0, noShow: 0 });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [risk, sched] = await Promise.all([
        api('/schedule-intel/risk?days=14').catch(() => []),
        api('/appointments?from=&to=').catch(() => []),
      ]);
      const all = Array.isArray(sched) ? sched : [];
      const myAppts = all.filter((a: Appointment) => a.dentist_id === user?.id);
      const riskAll = Array.isArray(risk) ? risk : [];
      setHighRiskAppts(riskAll.filter((a: Appointment) => (a.risk_score || 0) >= 60));
      setUpcomingAppts(
        myAppts.filter((a: Appointment) => ['confirmed', 'registered', 'waiting'].includes(a.status)).slice(0, 10),
      );
      const total = myAppts.length;
      const noShow = myAppts.filter((a: Appointment) => a.status === 'no-show').length;
      setNoShowData({ total, noShow });
      setLoading(false);
    }
    load();
  }, [api, user?.id]);

  return (
    <div>
      <PageHeader title="Inteligência de Agenda" sub="Visão do risco de falta e ocupação" />
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            <div className="card" style={{ borderLeft: '4px solid #0052CC' }}>
              <div className="section-label">Consultas Agendadas</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#0052CC' }}>{upcomingAppts.length}</div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid #DE350B' }}>
              <div className="section-label">Risco Alto (≥60%)</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#DE350B' }}>{highRiskAppts.length}</div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid #FF8B00' }}>
              <div className="section-label">Taxa de No-Show</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#FF8B00' }}>
                {noShowData.total > 0 ? Math.round((noShowData.noShow / noShowData.total) * 100) : 0}%
              </div>
            </div>
          </div>

          {highRiskAppts.length > 0 && (
            <div className="mt-5">
              <h3 style={{ fontSize: 16, fontWeight: 750, color: 'var(--ink)', marginBottom: 10 }}>
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
