'use client';
import { AlertTriangle, Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import DayCalendar from '@/components/DayCalendar';
import {
  FormField,
  GhostBtn,
  MetricCard,
  Modal,
  PageHeader,
  PrimaryBtn,
  RiskBadge,
  Sel,
  Spinner,
} from '@/components/ui';
import type { Appointment, Patient } from '@/lib/types';

interface Dentist {
  id: string;
  name: string;
}

interface BookForm {
  patientId: string;
  dentistId: string;
  startTime: string;
  duration: string;
  type: string;
  notes: string;
}

export default function ReceptionDashboard() {
  const { api, user } = useAuth();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<BookForm>({
    patientId: '',
    dentistId: '',
    startTime: '09:00',
    duration: '30',
    type: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  function pickAutoChair(existingAppts: Appointment[], startTime: string, duration: number) {
    const start = String(startTime || '09:00');
    const [h, m] = start.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + Number(duration || 30);
    const count = Math.max(1, Number(user?.operatories || 3));
    const chairs = Array.from({ length: count }, (_, i) => i + 1);
    const active = existingAppts.filter((a) => !['departed', 'no-show'].includes(a.status));

    for (const ch of chairs) {
      const conflict = active.some((a) => {
        if (Number(a.chair) !== ch) return false;
        const [ah, am] = String(a.start_time || '00:00')
          .split(':')
          .map(Number);
        const aStart = ah * 60 + am;
        const aEnd = aStart + Number(a.duration || 30);
        return startMin < aEnd && endMin > aStart;
      });
      if (!conflict) return ch;
    }
    return 1;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [a, p, d] = await Promise.all([
      api(`/appointments?date=${date}`).catch(() => []),
      api('/patients').catch(() => []),
      api('/dentists').catch(() => []),
    ]);
    setAppts(a || []);
    setPatients(p || []);
    setDentists(d || []);
    setLoading(false);
  }, [api, date]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(aptId: string, status: string) {
    const u = await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } }).catch(() => null);
    if (u) setAppts((prev) => prev.map((a) => (a.id === aptId ? { ...a, status } : a)));
  }

  async function handleBook() {
    if (!form.patientId || !form.type || !form.dentistId) return;
    setSaving(true);
    const patient = patients.find((p) => p.id === form.patientId);
    const autoChair = pickAutoChair(appts, form.startTime, Number(form.duration));
    const apt = await api('/appointments', {
      method: 'POST',
      body: {
        patientId: form.patientId,
        patientName: patient?.name || '',
        dentistId: form.dentistId,
        chair: autoChair,
        date,
        startTime: form.startTime,
        duration: Number(form.duration),
        type: form.type,
        notes: form.notes,
      },
    }).catch(() => null);
    if (apt) {
      setAppts((prev) => [...prev, apt]);
      setModal(false);
    }
    setSaving(false);
  }

  const waiting = appts.filter((a) => a.status === 'waiting').length;
  const inChair = appts.filter((a) => ['in-operatory', 'procedure-active'].includes(a.status)).length;
  const ready = appts.filter((a) => a.status === 'ready-dismissal').length;
  const highRisk = appts.filter((a) => (a.risk_score || 0) >= 60);
  const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <PageHeader title="Reception Dashboard" sub={label} action="+ Book Appointment" onAction={() => setModal(true)}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        />
      </PageHeader>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard label="SCHEDULED TODAY" value={appts.length} sub="total appointments" color="#0052CC" />
        <MetricCard label="WAITING ROOM" value={waiting} sub="checked in" color="#FF8B00" />
        <MetricCard label="IN CHAIR NOW" value={inChair} sub="in operatory" color="#00875A" />
        <MetricCard label="HIGH-RISK" value={highRisk.length} sub="call confirmation" color="#DE350B" />
      </div>

      {/* Banners */}
      {highRisk.length > 0 && (
        <div
          style={{
            background: '#FFEBE6',
            border: '1px solid #FFBDAD',
            borderRadius: 8,
            padding: '12px 18px',
            marginBottom: 16,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#DE350B' }}>
            {highRisk.length} high no-show risk appointment{highRisk.length > 1 ? 's' : ''} today
          </div>
          {highRisk.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: 'white',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
              }}
            >
              <strong style={{ color: '#172B4D' }}>{a.patient_name}</strong>
              <span style={{ color: '#97A0AF' }}>{String(a.start_time || '').slice(0, 5)}</span>
              <RiskBadge score={a.risk_score || 0} />
            </div>
          ))}
        </div>
      )}

      {ready > 0 && (
        <div
          style={{
            background: '#E3FCEF',
            border: '1px solid #57D9A3',
            borderRadius: 8,
            padding: '12px 18px',
            marginBottom: 16,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Check size={14} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#00875A' }}>
            {ready} patient{ready > 1 ? 's' : ''} ready for dismissal
          </div>
          {appts
            .filter((a) => a.status === 'ready-dismissal')
            .map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: 'white',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                }}
              >
                <strong style={{ color: '#172B4D' }}>{a.patient_name}</strong>
                <button
                  type="button"
                  onClick={() => handleStatusChange(a.id, 'departed')}
                  style={{
                    background: '#00875A',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Check Out
                </button>
              </div>
            ))}
        </div>
      )}

      {loading ? <Spinner /> : <DayCalendar appointments={appts} date={date} onStatusChange={handleStatusChange} />}

      {/* Book modal */}
      {modal && (
        <Modal title="Book New Appointment" onClose={() => setModal(false)} width={520}>
          <FormField label="Patient *">
            <Sel value={form.patientId} onChange={(e) => setForm((p) => ({ ...p, patientId: e.target.value }))}>
              <option value="">— Select patient —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} #{p.global_seq}
                  {(p.no_show_score || 0) >= 60 ? ' HIGH RISK' : ''}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Dentist *">
            <Sel value={form.dentistId} onChange={(e) => setForm((p) => ({ ...p, dentistId: e.target.value }))}>
              <option value="">— Select dentist —</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Appointment Type *">
            <Sel value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              <option value="">— Select type —</option>
              {[
                'Comprehensive Exam',
                'Hygiene Cleaning',
                'X-Ray Review',
                'Root Canal',
                'Crown Preparation',
                'Extraction',
                'Whitening',
                'Implant Consultation',
                'Full Mouth Rehabilitation',
                'Orthodontic Consult',
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Sel>
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Start Time">
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                className="input"
              />
            </FormField>
            <FormField label="Duration (min)">
              <Sel value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value }))}>
                {[15, 30, 45, 60, 90, 120].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Sel>
            </FormField>
          </div>
          <div style={{ fontSize: 12, color: '#97A0AF', marginTop: 2, marginBottom: 8 }}>
            Cadeira atribuida automaticamente com base na disponibilidade.
          </div>
          <FormField label="Notes">
            <input
              className="input"
              value={form.notes}
              placeholder="Optional notes…"
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={handleBook} disabled={saving || !form.patientId || !form.type || !form.dentistId}>
              {saving ? 'Booking…' : 'Book Appointment'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
