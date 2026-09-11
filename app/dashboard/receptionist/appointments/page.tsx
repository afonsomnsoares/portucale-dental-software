'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import AppointmentEditModal, { type AppointmentEditForm } from '@/components/receptionist/AppointmentEditModal';
import AppointmentsTable from '@/components/receptionist/AppointmentsTable';
import { DangerBtn, GhostBtn, Modal, PageHeader, Spinner } from '@/components/ui';
import type { Appointment } from '@/lib/types';

interface Dentist {
  id: string;
  name: string;
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReceptionAppointmentsPage() {
  const { api, settings } = useAuth();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Appointment | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [editForm, setEditForm] = useState<AppointmentEditForm>({
    date: '',
    startTime: '',
    duration: 30,
    chair: 1,
    dentistId: '',
    type: '',
    notes: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [statusPending, setStatusPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    params.set('limit', '1000');
    const rows = await api(`/appointments?${params.toString()}`).catch(() => []);
    setAppts(rows || []);
    setLoading(false);
  }, [api, from, to]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api('/dentists')
      .then((d) => setDentists(d || []))
      .catch(() => {});
  }, [api]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (appts || []).filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = [
        a.patient_name,
        a.dentist_name,
        a.type,
        a.status,
        String(a.appt_date || '').slice(0, 10),
        String(a.start_time || '').slice(0, 5),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [appts, q, statusFilter]);

  async function changeStatus(apt: Appointment, nextStatus: string) {
    if (!nextStatus || nextStatus === apt.status) return;
    const prevStatus = apt.status;
    setStatusPending((p) => ({ ...p, [apt.id]: true }));
    setAppts((prev) => prev.map((a) => (a.id === apt.id ? { ...a, status: nextStatus } : a)));
    try {
      const u = await api(`/appointments/${apt.id}/status`, { method: 'PUT', body: { status: nextStatus } });
      setAppts((prev) => prev.map((a) => (a.id === apt.id ? { ...a, ...u } : a)));
    } catch {
      setAppts((prev) => prev.map((a) => (a.id === apt.id ? { ...a, status: prevStatus } : a)));
    } finally {
      setStatusPending((p) => {
        const next = { ...p };
        delete next[apt.id];
        return next;
      });
    }
  }

  async function removeAppointment(apt: Appointment) {
    setRemoving(apt.id);
    try {
      const res = await api(`/appointments/${apt.id}`, { method: 'DELETE' }).catch(() => null);
      if (res?.deleted) setAppts((prev) => prev.filter((a) => a.id !== apt.id));
    } finally {
      setRemoving(null);
      setConfirm(null);
    }
  }

  function openEdit(a: Appointment) {
    setEditErr('');
    setEditing(a);
    setEditForm({
      date: String(a.appt_date || '').slice(0, 10),
      startTime: String(a.start_time || '').slice(0, 5),
      duration: Number(a.duration || 30),
      chair: Number(a.chair || 1),
      dentistId: a.dentist_id || '',
      type: a.type || '',
      notes: a.notes || '',
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setEditErr('');
    setEditSaving(true);
    try {
      const optimistic = {
        ...editing,
        appt_date: editForm.date,
        start_time: editForm.startTime,
        duration: Number(editForm.duration || 30),
        chair: Number(editForm.chair || 1),
        dentist_id: editForm.dentistId || null,
        dentist_name: dentists.find((d) => d.id === editForm.dentistId)?.name || editing.dentist_name,
        type: editForm.type,
        notes: editForm.notes,
      };
      setAppts((prev) => prev.map((a) => (a.id === editing.id ? optimistic : a)));
      const u = await api(`/appointments/${editing.id}`, {
        method: 'PUT',
        body: {
          date: editForm.date,
          startTime: editForm.startTime,
          duration: Number(editForm.duration || 30),
          chair: Number(editForm.chair || 1),
          dentistId: editForm.dentistId || null,
          type: editForm.type,
          notes: editForm.notes,
        },
      });
      setAppts((prev) => prev.map((a) => (a.id === u.id ? { ...a, ...u } : a)));
      setEditing(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Falha ao guardar.');
      await load();
    } finally {
      setEditSaving(false);
    }
  }

  function exportCsv() {
    const rows = (filtered || []).map((a) => ({
      date: String(a.appt_date || '').slice(0, 10),
      time: String(a.start_time || '').slice(0, 5),
      patient: a.patient_name || '',
      dentist: a.dentist_name || '',
      type: a.type || '',
      chair: a.chair ?? '',
      status: a.status || '',
      duration: a.duration ?? '',
      notes: a.notes || '',
    }));
    const header = ['date', 'time', 'patient', 'dentist', 'type', 'chair', 'status', 'duration', 'notes'] as const;
    const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = [header.join(','), ...rows.map((r) => header.map((k) => esc(r[k])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointments_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title="Consultas" sub="Todas as consultas marcadas">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Procurar doente, tipo, dentista…"
          className="input"
          style={{ width: 260, padding: '7px 12px', fontSize: 13 }}
        />
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
        >
          <option value="">Todos os estados</option>
          {Object.keys(settings?.STATUS_META || {}).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
        <GhostBtn onClick={exportCsv} style={{ padding: '8px 12px' }} disabled={!filtered.length}>
          Exportar CSV
        </GhostBtn>
      </PageHeader>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : (
          <AppointmentsTable
            rows={filtered}
            settings={settings}
            removingId={removing}
            onEdit={openEdit}
            onCancel={(a) => setConfirm(a)}
            onChangeStatus={changeStatus}
            statusPending={statusPending}
          />
        )}
      </div>

      {confirm && (
        <Modal title="Cancelar consulta" onClose={() => setConfirm(null)} width={520}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8, fontWeight: 700 }}>
            {confirm.patient_name || '—'} · {String(confirm.appt_date || '').slice(0, 10)}{' '}
            {String(confirm.start_time || '').slice(0, 5)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Isto remove a consulta da agenda.
          </div>
          <div className="flex gap-3">
            <DangerBtn onClick={() => removeAppointment(confirm)} disabled={removing === confirm.id}>
              {removing === confirm.id ? 'A cancelar…' : 'Cancelar consulta'}
            </DangerBtn>
            <GhostBtn onClick={() => setConfirm(null)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}

      <AppointmentEditModal
        open={!!editing}
        onClose={() => setEditing(null)}
        dentists={dentists}
        value={editForm}
        onChange={setEditForm}
        onSave={saveEdit}
        saving={editSaving}
        error={editErr}
      />
    </div>
  );
}
