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
import { APPOINTMENT_TYPES, getDefaultDuration } from '@/lib/constants';
import type { Appointment, Patient, SuggestedSlot } from '@/lib/types';

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

const EMPTY_BOOK_FORM: BookForm = {
  patientId: '',
  dentistId: '',
  startTime: '09:00',
  duration: '30',
  type: '',
  notes: '',
};

export default function ReceptionDashboard() {
  const { api, user } = useAuth();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<BookForm>(EMPTY_BOOK_FORM);
  const [saving, setSaving] = useState(false);
  const [bookErr, setBookErr] = useState('');

  // Auto-suggest flow (default) vs. the original fully-manual fields, kept as
  // an escape hatch for cases the engine can't or shouldn't handle on its own
  // (booking outside normal hours, an unlisted dentist situation, etc).
  const [mode, setMode] = useState<'suggest' | 'manual'>('suggest');
  const [preferredDentistId, setPreferredDentistId] = useState('');
  const [suggestFromDate, setSuggestFromDate] = useState(date);
  const [slots, setSlots] = useState<SuggestedSlot[]>([]);
  const [slotsDuration, setSlotsDuration] = useState(30);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SuggestedSlot | null>(null);

  // Same idea as lib/scheduling.ts's pickFreeChair (server-side, used by
  // /api/appointments/suggest) — kept here too only for the manual-mode
  // fallback, where there is no suggested slot carrying its own chair.
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

  const fetchSlots = useCallback(async () => {
    if (!form.patientId || !form.type) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    const params = new URLSearchParams({
      patientId: form.patientId,
      type: form.type,
      fromDate: suggestFromDate,
    });
    if (preferredDentistId) params.set('dentistId', preferredDentistId);
    const res = await api(`/appointments/suggest?${params.toString()}`).catch(() => null);
    setSlots(res?.slots || []);
    setSlotsDuration(res?.duration || getDefaultDuration(form.type));
    setSlotsLoading(false);
  }, [api, form.patientId, form.type, preferredDentistId, suggestFromDate]);

  useEffect(() => {
    if (mode !== 'suggest') return;
    setSelectedSlot(null);
    fetchSlots();
  }, [mode, fetchSlots]);

  function openBookModal() {
    setForm(EMPTY_BOOK_FORM);
    setBookErr('');
    setMode('suggest');
    setPreferredDentistId('');
    setSuggestFromDate(date);
    setSlots([]);
    setSelectedSlot(null);
    setModal(true);
  }

  function moreSlots() {
    setSuggestFromDate((d) => {
      const next = new Date(`${d}T12:00:00`);
      next.setDate(next.getDate() + 7);
      return next.toISOString().slice(0, 10);
    });
  }

  async function handleStatusChange(aptId: string, status: string) {
    const u = await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } }).catch(() => null);
    if (u) setAppts((prev) => prev.map((a) => (a.id === aptId ? { ...a, status } : a)));
  }

  async function handleBook() {
    setBookErr('');
    if (!form.patientId || !form.type) return;

    let dentistId: string;
    let bookDate: string;
    let startTime: string;
    let duration: number;
    let chair: number;

    if (mode === 'suggest') {
      if (!selectedSlot) return;
      dentistId = selectedSlot.dentistId;
      bookDate = selectedSlot.date;
      startTime = selectedSlot.startTime;
      duration = slotsDuration;
      chair = selectedSlot.chair;
    } else {
      if (!form.dentistId) return;
      dentistId = form.dentistId;
      bookDate = date;
      startTime = form.startTime;
      duration = Number(form.duration);
      chair = pickAutoChair(appts, startTime, duration);
    }

    setSaving(true);
    const patient = patients.find((p) => p.id === form.patientId);
    try {
      const apt = await api('/appointments', {
        method: 'POST',
        body: {
          patientId: form.patientId,
          patientName: patient?.name || '',
          dentistId,
          chair,
          date: bookDate,
          startTime,
          duration,
          type: form.type,
          notes: form.notes,
        },
      });
      // The suggestion engine looks up to a week ahead — only splice the new
      // appointment into today's on-screen calendar if it actually landed on
      // the day currently being viewed, otherwise it would show up floating
      // on the wrong day.
      if (bookDate === date) setAppts((prev) => [...prev, apt]);
      setModal(false);
    } catch (e) {
      setBookErr(e instanceof Error ? e.message : 'Falha ao marcar a consulta.');
      if (mode === 'suggest') fetchSlots(); // the chosen slot may have just been taken — refresh
    } finally {
      setSaving(false);
    }
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
      <PageHeader title="Reception Dashboard" sub={label} action="+ Book Appointment" onAction={openBookModal}>
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
        <Modal title="Book New Appointment" onClose={() => setModal(false)} width={560}>
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
          <FormField label="Appointment Type *">
            <Sel value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              <option value="">— Select type —</option>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </Sel>
          </FormField>

          <div className="flex items-center justify-between" style={{ marginTop: 4, marginBottom: 10 }}>
            <span className="section-label">{mode === 'suggest' ? 'Horários sugeridos' : 'Marcação manual'}</span>
            <GhostBtn
              onClick={() => setMode((m) => (m === 'suggest' ? 'manual' : 'suggest'))}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              {mode === 'suggest' ? 'Marcação manual (avançado)' : 'Voltar às sugestões'}
            </GhostBtn>
          </div>

          {mode === 'suggest' ? (
            <div style={{ marginBottom: 12 }}>
              <FormField label="Preferir um dentista específico (opcional)">
                <Sel value={preferredDentistId} onChange={(e) => setPreferredDentistId(e.target.value)}>
                  <option value="">— Qualquer dentista disponível —</option>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Sel>
              </FormField>

              {!form.patientId || !form.type ? (
                <div style={{ fontSize: 12, color: '#97A0AF', padding: '10px 0' }}>
                  Escolha o paciente e o tipo de consulta para ver horários disponíveis.
                </div>
              ) : slotsLoading ? (
                <Spinner />
              ) : !slots.length ? (
                <div style={{ fontSize: 12, color: '#97A0AF', padding: '10px 0' }}>
                  Sem horários disponíveis nos próximos dias.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {slots.map((s) => {
                    const isSelected =
                      selectedSlot &&
                      selectedSlot.date === s.date &&
                      selectedSlot.startTime === s.startTime &&
                      selectedSlot.dentistId === s.dentistId;
                    return (
                      <button
                        type="button"
                        key={`${s.dentistId}-${s.date}-${s.startTime}`}
                        onClick={() => setSelectedSlot(s)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: `1.5px solid ${isSelected ? '#0052CC' : '#DFE1E6'}`,
                          background: isSelected ? '#DEEBFF' : 'white',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#172B4D' }}>
                          {new Date(`${s.date}T12:00:00`).toLocaleDateString('pt-PT', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                          })}{' '}
                          · {s.startTime}
                        </span>
                        <span style={{ fontSize: 12, color: '#5E6C84' }}>
                          {s.dentistName} · Gabinete {s.chair}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <GhostBtn onClick={moreSlots} style={{ marginTop: 10, fontSize: 12 }} disabled={slotsLoading}>
                Ver mais horários
              </GhostBtn>
            </div>
          ) : (
            <>
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
                Cadeira atribuída automaticamente com base na disponibilidade. Marca para o dia atualmente aberto no
                calendário ({date}).
              </div>
            </>
          )}

          <FormField label="Notes">
            <input
              className="input"
              value={form.notes}
              placeholder="Optional notes…"
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>

          {bookErr && (
            <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{bookErr}</div>
          )}

          <div className="flex gap-3 mt-2">
            <PrimaryBtn
              onClick={handleBook}
              disabled={
                saving || !form.patientId || !form.type || (mode === 'suggest' ? !selectedSlot : !form.dentistId)
              }
            >
              {saving ? 'Booking…' : 'Book Appointment'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
