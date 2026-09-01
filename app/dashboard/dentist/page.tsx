'use client';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import DayCalendar from '@/components/DayCalendar';
import DailyBriefingPanel from '@/components/patient/DailyBriefingPanel';
import { MetricCard, PageHeader, Spinner } from '@/components/ui';
import type { Appointment, DailyBriefingRow, Treatment } from '@/lib/types';

export default function DentistDashboard() {
  const { api, user } = useAuth();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const [a, t, b] = await Promise.all([
      api(`/appointments?date=${date}`).catch(() => []),
      api('/treatments').catch(() => []),
      api(`/daily-briefing?date=${date}`).catch(() => null),
    ]);
    setAppts(a || []);
    setTreatments(t || []);
    setBriefing(b?.rows || []);
    setLoading(false);
  }, [api, date]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(aptId: string, status: string) {
    const u = await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } }).catch(() => null);
    if (u) setAppts((prev) => prev.map((a) => (a.id === aptId ? { ...a, status } : a)));
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
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        />
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard label="TODAY'S APPOINTMENTS" value={appts.length} sub="scheduled" color="#0052CC" />
        <MetricCard label="IN CHAIR NOW" value={inChair} sub="in operatory" color="#00875A" />
        <MetricCard label="PENDING TREATMENTS" value={pending} sub="awaiting decision" color="#FF8B00" />
        <MetricCard label="HIGH-RISK APPTS" value={highRisk} sub="may not show" color="#DE350B" />
      </div>
      {ready.length > 0 && (
        <div
          style={{
            background: '#E3FCEF',
            border: '1px solid #57D9A3',
            borderRadius: 8,
            padding: '12px 18px',
            marginBottom: 18,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Check size={14} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#00875A' }}>Patients ready for dismissal:</span>
          {ready.map((a) => (
            <span
              key={a.id}
              style={{
                background: 'white',
                borderRadius: 5,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: '#172B4D',
              }}
            >
              {a.patient_name}
            </span>
          ))}
        </div>
      )}
      {loading ? (
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
