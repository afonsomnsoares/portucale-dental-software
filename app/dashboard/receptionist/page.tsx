'use client';
import { AlertTriangle, Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import DayCalendar from '@/components/DayCalendar';
import DailyBriefingPanel from '@/components/patient/DailyBriefingPanel';
import {
  ErrorState,
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
import { useQuery } from '@/hooks/useQuery';
import { APPOINTMENT_TYPES, getDefaultDuration } from '@/lib/constants';
import type { Appointment, DailyBriefingRow, Patient, SuggestedSlot } from '@/lib/types';

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

  // ─── O que falta fazer a cada doente de hoje ──────────────────────────────
  // lib/dailyBriefing.ts e DailyBriefingPanel existiam e nenhuma página os chamava. As
  // métricas acima dizem QUANTOS; isto diz QUEM e O QUÊ — dados em falta, consentimento
  // por assinar, saldo em aberto — que é a pergunta que a receção faz de facto.
  //
  // Falha em silêncio de propósito: um briefing que não carrega não deve impedir a
  // receção de ver a agenda do dia.
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

  // A agenda é o ecrã de onde a recepção trabalha o dia inteiro, e era o que
  // tinha a pior ligação entre as quatro leituras: um Promise.all com um só
  // `loading`. O briefing a demorar atrasava a agenda, e qualquer uma a falhar
  // saía como lista vazia — «não há consultas hoje» quando ninguém foi ver.
  const apptsQuery = useQuery<Appointment[]>(`/appointments?date=${date}`);
  const patientsQuery = useQuery<Patient[]>('/patients');
  const dentistsQuery = useQuery<Dentist[]>('/dentists');
  const briefingQuery = useQuery<{ rows: DailyBriefingRow[] }>(`/daily-briefing?date=${date}`);

  const appts = apptsQuery.data ?? [];
  const patients = patientsQuery.data ?? [];
  const dentists = dentistsQuery.data ?? [];
  const briefing = briefingQuery.data?.rows ?? [];

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
    setBookErr('');
    try {
      const res = await api(`/appointments/suggest?${params.toString()}`);
      setSlots(res?.slots || []);
      setSlotsDuration(res?.duration || getDefaultDuration(form.type));
    } catch (e) {
      // «Sem vagas» e «não consegui procurar» são conclusões opostas, e a lista
      // vazia desenhava-se como a primeira.
      setSlots([]);
      setSlotsDuration(getDefaultDuration(form.type));
      setBookErr(e instanceof Error ? e.message : 'Não foi possível procurar vagas.');
    }
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
    setBookErr('');
    try {
      await api(`/appointments/${aptId}/status`, { method: 'PUT', body: { status } });
      apptsQuery.refetch();
    } catch (e) {
      // Marcar alguém como «chegou» ou «faltou» falhava sem sinal nenhum — e é
      // a ação mais repetida deste ecrã.
      setBookErr(e instanceof Error ? e.message : 'Não foi possível mudar o estado da consulta.');
    }
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
      await api('/appointments', {
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
      // O motor de sugestões procura até uma semana à frente; só vale a pena
      // revalidar a agenda se a consulta caiu no dia que está no ecrã.
      if (bookDate === date) apptsQuery.refetch();
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
  const label = new Date(`${date}T12:00:00`).toLocaleDateString('pt-PT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <PageHeader title="Receção" sub={label} action="+ Marcar consulta" onAction={openBookModal}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 'var(--text-sm)' }}
        />
      </PageHeader>

      {/* KPIs */}
      <div className="grid-cards" style={{ gap: 12, marginBottom: 20 }}>
        <MetricCard label="MARCADAS PARA HOJE" value={appts.length} sub="consultas no total" color="var(--accent)" />
        <MetricCard label="SALA DE ESPERA" value={waiting} sub="com entrada registada" color="var(--urgency-soon)" />
        <MetricCard label="EM CADEIRA AGORA" value={inChair} sub="em gabinete" color="var(--urgency-ok)" />
        <MetricCard
          label="RISCO ELEVADO"
          value={highRisk.length}
          sub="a confirmar por telefone"
          color="var(--urgency-critical)"
        />
      </div>

      {/* Banners */}
      {highRisk.length > 0 && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            border: '1px solid var(--urgency-critical-border)',
            borderRadius: 'var(--radius-control)',
            padding: '12px 18px',
            marginBottom: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <div
            style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--urgency-critical)' }}
          >
            {highRisk.length} consulta{highRisk.length > 1 ? 's' : ''} com alto risco de falta hoje
          </div>
          {highRisk.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: 'white',
                borderRadius: 'var(--radius-control)',
                padding: '5px 12px',
                fontSize: 'var(--text-xs)',
              }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>{a.patient_name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>{String(a.start_time || '').slice(0, 5)}</span>
              <RiskBadge score={a.risk_score || 0} />
            </div>
          ))}
        </div>
      )}

      {ready > 0 && (
        <div
          style={{
            background: 'var(--urgency-ok-bg)',
            border: '1px solid var(--urgency-ok-border)',
            borderRadius: 'var(--radius-control)',
            padding: '12px 18px',
            marginBottom: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Check size={14} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--urgency-ok)' }}>
            {ready} doente{ready > 1 ? 's' : ''} pronto{ready > 1 ? 's' : ''} para alta
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
                  borderRadius: 'var(--radius-control)',
                  padding: '5px 12px',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <strong style={{ color: 'var(--text-primary)' }}>{a.patient_name}</strong>
                <button
                  type="button"
                  onClick={() => handleStatusChange(a.id, 'departed')}
                  style={{
                    background: 'var(--urgency-ok)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-control)',
                    padding: '3px 10px',
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-bold)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Dar alta
                </button>
              </div>
            ))}
        </div>
      )}

      {/* O que falta fazer, antes do calendário: a agenda diz quem vem, isto diz o que
          é preciso ter tratado antes de a pessoa chegar. */}
      {!briefingQuery.loading && briefing.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <DailyBriefingPanel api={api} rows={briefing} />
        </div>
      )}

      {apptsQuery.error ? (
        <ErrorState error={apptsQuery.error} onRetry={apptsQuery.refetch} message="Não foi possível ler a agenda." />
      ) : apptsQuery.loading ? (
        <Spinner />
      ) : (
        <DayCalendar appointments={appts} date={date} onStatusChange={handleStatusChange} />
      )}

      {/* Book modal */}
      {modal && (
        <Modal title="Marcar consulta" onClose={() => setModal(false)} width={560}>
          <FormField label="Doente *">
            <Sel value={form.patientId} onChange={(e) => setForm((p) => ({ ...p, patientId: e.target.value }))}>
              <option value="">— Selecionar doente —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} #{p.global_seq}
                  {(p.no_show_score || 0) >= 60 ? ' ALTO RISCO' : ''}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Tipo de consulta *">
            <Sel value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              <option value="">— Selecionar tipo —</option>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </Sel>
          </FormField>

          <div className="flex items-center justify-between" style={{ marginTop: 4, marginBottom: 12 }}>
            <span className="section-label">{mode === 'suggest' ? 'Horários sugeridos' : 'Marcação manual'}</span>
            <GhostBtn
              onClick={() => setMode((m) => (m === 'suggest' ? 'manual' : 'suggest'))}
              style={{ padding: '4px 10px', fontSize: 'var(--text-2xs)' }}
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
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', padding: '10px 0' }}>
                  Escolha o paciente e o tipo de consulta para ver horários disponíveis.
                </div>
              ) : slotsLoading ? (
                <Spinner />
              ) : !slots.length ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', padding: '10px 0' }}>
                  Sem horários disponíveis nos próximos dias.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
                          borderRadius: 'var(--radius-control)',
                          border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`,
                          background: isSelected ? 'var(--accent-bg)' : 'white',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--weight-semibold)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {new Date(`${s.date}T12:00:00`).toLocaleDateString('pt-PT', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                          })}{' '}
                          · {s.startTime}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                          {s.dentistName} · Gabinete {s.chair}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <GhostBtn
                onClick={moreSlots}
                style={{ marginTop: 12, fontSize: 'var(--text-xs)' }}
                disabled={slotsLoading}
              >
                Ver mais horários
              </GhostBtn>
            </div>
          ) : (
            <>
              <FormField label="Dentista *">
                <Sel value={form.dentistId} onChange={(e) => setForm((p) => ({ ...p, dentistId: e.target.value }))}>
                  <option value="">— Selecionar dentista —</option>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Sel>
              </FormField>
              <div className="grid-pair" style={{ gap: 12 }}>
                <FormField label="Hora de início">
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="input"
                  />
                </FormField>
                <FormField label="Duração (min)">
                  <Sel value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value }))}>
                    {[15, 30, 45, 60, 90, 120].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </Sel>
                </FormField>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2, marginBottom: 8 }}>
                Cadeira atribuída automaticamente com base na disponibilidade. Marca para o dia atualmente aberto no
                calendário ({date}).
              </div>
            </>
          )}

          <FormField label="Notas">
            <input
              className="input"
              value={form.notes}
              placeholder="Notas opcionais…"
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>

          {bookErr && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-bold)',
                marginBottom: 12,
              }}
            >
              {bookErr}
            </div>
          )}

          <div className="flex gap-3 mt-2">
            <PrimaryBtn
              onClick={handleBook}
              disabled={
                saving || !form.patientId || !form.type || (mode === 'suggest' ? !selectedSlot : !form.dentistId)
              }
            >
              {saving ? 'A marcar…' : 'Marcar consulta'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
