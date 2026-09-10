'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { GhostBtn, PrimaryBtn, Sel } from '@/components/ui';
import { describePreferences, WEEKDAY_LABEL_PT } from '@/lib/schedulingPrefsCalc';
import type { Patient, PatientSchedulingPrefs } from '@/lib/types';

interface SchedulingPrefsCardProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  patient: Patient;
}

// Segunda primeiro, domingo no fim — ordem de semana de trabalho, ao contrário
// da ordem numérica 0..6 do Postgres/JS que guardamos.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface FormState {
  preferredDentistId: string;
  preferredDays: number[];
  preferredTimeStart: string;
  preferredTimeEnd: string;
  notes: string;
}

const EMPTY: FormState = {
  preferredDentistId: '',
  preferredDays: [],
  preferredTimeStart: '',
  preferredTimeEnd: '',
  notes: '',
};

export default function SchedulingPrefsCard({ api, patient }: SchedulingPrefsCardProps) {
  const [saved, setSaved] = useState<PatientSchedulingPrefs | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [dentists, setDentists] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const row: PatientSchedulingPrefs | null = await api(`/patients/${patient.id}/scheduling-prefs`).catch(() => null);
    setSaved(row);
    setForm(
      row
        ? {
            preferredDentistId: row.preferred_dentist_id || '',
            preferredDays: row.preferred_days || [],
            preferredTimeStart: row.preferred_time_start?.slice(0, 5) || '',
            preferredTimeEnd: row.preferred_time_end?.slice(0, 5) || '',
            notes: row.notes || '',
          }
        : EMPTY,
    );
    setEditing(false);
    setError('');
  }, [api, patient.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // /dentists está aberto a rececionista e admin; um dentista a ver a própria
    // ficha recebe 403 e fica só sem o seletor, sem quebrar o resto do cartão.
    api('/dentists')
      .then((d) => setDentists(d || []))
      .catch(() => setDentists([]));
  }, [api]);

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      preferredDays: f.preferredDays.includes(day)
        ? f.preferredDays.filter((d) => d !== day)
        : [...f.preferredDays, day].sort((a, b) => a - b),
    }));
  }

  async function save() {
    if (form.preferredTimeStart && form.preferredTimeEnd && form.preferredTimeEnd <= form.preferredTimeStart) {
      setError('A hora de fim tem de ser depois da hora de início.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/patients/${patient.id}/scheduling-prefs`, {
        method: 'PUT',
        body: {
          preferredDentistId: form.preferredDentistId || null,
          preferredDays: form.preferredDays.length ? form.preferredDays : null,
          preferredTimeStart: form.preferredTimeStart || null,
          preferredTimeEnd: form.preferredTimeEnd || null,
          notes: form.notes,
        },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gravar as preferências.');
    } finally {
      setSaving(false);
    }
  }

  const summary = describePreferences(
    {
      preferredDentistId: saved?.preferred_dentist_id || null,
      preferredDays: saved?.preferred_days || null,
      preferredTimeStart: saved?.preferred_time_start?.slice(0, 5) || null,
      preferredTimeEnd: saved?.preferred_time_end?.slice(0, 5) || null,
    },
    saved?.preferred_dentist_name,
  );

  return (
    <div
      className="card"
      style={{
        padding: '14px 18px',
        border: '1px solid var(--border-subtle)',
        gridColumn: '1 / -1',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="section-label">PREFERÊNCIAS DE MARCAÇÃO</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
            Usadas para ordenar os horários sugeridos. Nunca impedem uma marcação.
          </div>
        </div>
        {!editing && (
          <GhostBtn onClick={() => setEditing(true)} style={{ padding: '4px 12px', fontSize: 12 }}>
            Editar
          </GhostBtn>
        )}
      </div>

      {!editing ? (
        <div className="text-sm" style={{ color: summary ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {summary || 'Sem preferências definidas — qualquer horário serve.'}
          {saved?.notes && (
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {saved.notes}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="section-label mb-2">DIAS PREFERIDOS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {WEEKDAY_ORDER.map((d) => {
              const on = form.preferredDays.includes(d);
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--accent-bg)' : 'var(--bg-surface)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)',
                    borderRadius: 'var(--radius-control)',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: on ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {WEEKDAY_LABEL_PT[d].slice(0, 3)}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div className="section-label mb-1">A PARTIR DE</div>
              <input
                type="time"
                className="input"
                value={form.preferredTimeStart}
                onChange={(e) => setForm((f) => ({ ...f, preferredTimeStart: e.target.value }))}
              />
            </div>
            <div>
              <div className="section-label mb-1">ATÉ</div>
              <input
                type="time"
                className="input"
                value={form.preferredTimeEnd}
                onChange={(e) => setForm((f) => ({ ...f, preferredTimeEnd: e.target.value }))}
              />
            </div>
            <div>
              <div className="section-label mb-1">DENTISTA</div>
              <Sel
                value={form.preferredDentistId}
                onChange={(e) => setForm((f) => ({ ...f, preferredDentistId: e.target.value }))}
              >
                <option value="">— Sem preferência —</option>
                {dentists.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Sel>
            </div>
          </div>

          <div className="section-label mb-1">NOTAS</div>
          <input
            className="input"
            value={form.notes}
            placeholder="Ex.: não pode faltar ao trabalho depois das 14h"
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            style={{ marginBottom: 12 }}
          />

          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={load} disabled={saving}>
              Cancelar
            </GhostBtn>
            <PrimaryBtn onClick={save} disabled={saving}>
              {saving ? 'A gravar…' : 'Gravar'}
            </PrimaryBtn>
          </div>
        </div>
      )}
    </div>
  );
}
