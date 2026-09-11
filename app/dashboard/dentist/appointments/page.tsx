'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import DayCalendar from '@/components/DayCalendar';
import { AlertBanner, Badge, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Appointment } from '@/lib/types';

export default function DentistAppointmentsPage() {
  const { api, user } = useAuth();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [erro, setErro] = useState('');
  const apptsQuery = useQuery<Appointment[]>(user?.id ? `/appointments?date=${date}&dentistId=${user.id}` : null);
  // A rota já filtra por dentista; o filtro local é a segunda linha, para o caso
  // de uma resposta em cache de outro contexto.
  const appts = (apptsQuery.data ?? []).filter((a) => a.dentist_id === user?.id);

  const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const inChair = appts.filter((a) => ['in-operatory', 'procedure-active'].includes(a.status)).length;
  const highRisk = appts.filter((a) => (a.risk_score || 0) >= 60).length;

  async function handleStatusChange(aptId: string, status: string) {
    setErro('');
    try {
      await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } });
      apptsQuery.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar o estado da consulta.');
    }
  }

  return (
    <div>
      {erro ? <AlertBanner type="danger">{erro}</AlertBanner> : null}
      <PageHeader title="As Minhas Consultas" sub={label}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        />
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="section-label">Consultas Hoje</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>{appts.length}</div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid var(--urgency-ok)' }}>
          <div className="section-label">Em Consultório</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--urgency-ok)' }}>{inChair}</div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid var(--urgency-critical)' }}>
          <div className="section-label">Risco Alto</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--urgency-critical)' }}>{highRisk}</div>
        </div>
      </div>
      {apptsQuery.loading ? (
        <Spinner />
      ) : (
        <>
          <DayCalendar appointments={appts} date={date} onStatusChange={handleStatusChange} />
          {appts.filter((a) => a.status === 'confirmed' || a.status === 'registered').length > 0 && (
            <div className="mt-5">
              <h3 style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)', marginBottom: 10 }}>
                Próximas Consultas
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="data-th">Doente</th>
                    <th className="data-th">Hora</th>
                    <th className="data-th">Estado</th>
                    <th className="data-th" style={{ textAlign: 'right' }}>
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {appts
                    .filter((a) => ['confirmed', 'registered', 'waiting'].includes(a.status))
                    .map((a) => (
                      <tr key={a.id}>
                        <td className="data-td">{a.patient_name}</td>
                        <td className="data-td">{a.start_time?.slice(0, 5)}</td>
                        <td className="data-td">
                          <Badge s={a.status} />
                        </td>
                        <td className="data-td" style={{ textAlign: 'right' }}>
                          {['confirmed', 'registered', 'waiting'].includes(a.status) && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => handleStatusChange(a.id, 'in-operatory')}
                            >
                              Iniciar
                            </button>
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
