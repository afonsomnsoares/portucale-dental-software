'use client';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import DayCalendar from '@/components/DayCalendar';
import DailyBriefingPanel from '@/components/patient/DailyBriefingPanel';
import { AlertBanner, MetricCard, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Appointment, DailyBriefingRow, Treatment } from '@/lib/types';

export default function DentistDashboard() {
  const { api, user } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState('');

  const apptsQuery = useQuery<Appointment[]>(`/appointments?date=${date}`);
  const treatmentsQuery = useQuery<Treatment[]>('/treatments');
  const briefingQuery = useQuery<{ rows: DailyBriefingRow[] }>(`/daily-briefing?date=${date}`);

  const appts = apptsQuery.data ?? [];
  const treatments = treatmentsQuery.data ?? [];
  const briefing = briefingQuery.data?.rows ?? [];

  async function handleStatusChange(aptId: string, status: string) {
    setErro('');
    try {
      await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } });
      apptsQuery.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar o estado da consulta.');
    }
  }

  const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const inChair = appts.filter((a) => ['in-operatory', 'procedure-active'].includes(a.status)).length;
  const pending = treatments.filter((t) => t.status === 'proposed').length;
  const highRisk = appts.filter((a) => (a.risk_score || 0) >= 60).length;
  const ready = appts.filter((a) => a.status === 'ready-dismissal');

  return (
    <div>
      <PageHeader title={`Dr. ${user?.name?.split(' ').slice(-1)[0] || 'Carter'} — Clinical Dashboard`} sub={label}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 'var(--text-sm)' }}
        />
      </PageHeader>
      {erro ? <AlertBanner type="danger">{erro}</AlertBanner> : null}
      {apptsQuery.error ? (
        <AlertBanner type="danger">Não foi possível ler a agenda de hoje. {apptsQuery.error.message}</AlertBanner>
      ) : null}
      <div className="grid-cards" style={{ gap: 12, marginBottom: 20 }}>
        <MetricCard label="CONSULTAS DE HOJE" value={appts.length} sub="marcadas" color="var(--accent)" />
        <MetricCard label="EM CADEIRA AGORA" value={inChair} sub="em gabinete" color="var(--urgency-ok)" />
        <MetricCard
          label="TRATAMENTOS PENDENTES"
          value={pending}
          sub="à espera de decisão"
          color="var(--urgency-soon)"
        />
        <MetricCard label="CONSULTAS DE RISCO" value={highRisk} sub="podem faltar" color="var(--urgency-critical)" />
      </div>
      {ready.length > 0 && (
        <div
          style={{
            background: 'var(--urgency-ok-bg)',
            border: '1px solid var(--urgency-ok-border)',
            borderRadius: 'var(--radius-control)',
            padding: '12px 18px',
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Check size={14} />
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--urgency-ok)' }}>
            Patients ready for dismissal:
          </span>
          {ready.map((a) => (
            <span
              key={a.id}
              style={{
                background: 'white',
                borderRadius: 'var(--radius-control)',
                padding: '4px 12px',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--text-primary)',
              }}
            >
              {a.patient_name}
            </span>
          ))}
        </div>
      )}
      {apptsQuery.loading ? (
        <Spinner />
      ) : (
        <>
          <DayCalendar appointments={appts} date={date} onStatusChange={handleStatusChange} />
          <div className="mt-5">
            <DailyBriefingPanel api={api} rows={briefing} />
          </div>
        </>
      )}
    </div>
  );
}
