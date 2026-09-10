import type { ChangeEvent, FormEvent } from 'react';
import { FormField, GhostBtn, Inp, Modal, PrimaryBtn, Sel } from '@/components/ui';
import type { Patient } from '@/lib/types';
import { WEEKDAYS } from './scheduleIntelConstants';

export interface NewWaitlistForm {
  patientId: string;
  treatmentType: string;
  preferredDentistId: string;
  preferredDays: number[];
  preferredTimeStart: string;
  preferredTimeEnd: string;
  minDuration: number | string;
  maxWaitUntil: string;
  notes: string;
}

export const EMPTY_WAITLIST_FORM: NewWaitlistForm = {
  patientId: '',
  treatmentType: '',
  preferredDentistId: '',
  preferredDays: [],
  preferredTimeStart: '',
  preferredTimeEnd: '',
  minDuration: 30,
  maxWaitUntil: '',
  notes: '',
};

export default function WaitlistCreateModal({
  form,
  onChange,
  onSubmit,
  saving,
  patients,
  dentists,
  onClose,
}: {
  form: NewWaitlistForm;
  onChange: (form: NewWaitlistForm) => void;
  onSubmit: (e: FormEvent) => void;
  saving: boolean;
  patients: Patient[];
  dentists: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  function toggleDay(day: number) {
    onChange({
      ...form,
      preferredDays: form.preferredDays.includes(day)
        ? form.preferredDays.filter((d) => d !== day)
        : [...form.preferredDays, day],
    });
  }

  return (
    <Modal title="Adicionar à lista de espera" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <FormField label="Doente">
          <Sel value={form.patientId} onChange={(e) => onChange({ ...form, patientId: e.target.value })} required>
            <option value="">— Selecionar —</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Sel>
        </FormField>
        <FormField label="Tratamento pretendido">
          <Inp
            value={form.treatmentType}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, treatmentType: e.target.value })}
            placeholder="Ex: Consulta de higiene"
            required
          />
        </FormField>
        <FormField label="Dentista preferido (opcional)">
          <Sel
            value={form.preferredDentistId}
            onChange={(e) => onChange({ ...form, preferredDentistId: e.target.value })}
          >
            <option value="">Qualquer dentista</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Sel>
        </FormField>
        <FormField label="Dias preferidos (opcional)">
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAYS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDay(d.key)}
                className="btn"
                style={{
                  padding: '5px 10px',
                  fontSize: 12,
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--border-subtle)',
                  background: form.preferredDays.includes(d.key) ? 'var(--accent-bg)' : 'transparent',
                  color: form.preferredDays.includes(d.key) ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Hora início (opcional)">
            <Inp
              type="time"
              value={form.preferredTimeStart}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, preferredTimeStart: e.target.value })}
            />
          </FormField>
          <FormField label="Hora fim (opcional)">
            <Inp
              type="time"
              value={form.preferredTimeEnd}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, preferredTimeEnd: e.target.value })}
            />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Duração mínima (min)">
            <Inp
              type="number"
              min={5}
              step={5}
              value={form.minDuration}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, minDuration: e.target.value })}
            />
          </FormField>
          <FormField label="Esperar até (opcional)">
            <Inp
              type="date"
              value={form.maxWaitUntil}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, maxWaitUntil: e.target.value })}
            />
          </FormField>
        </div>
        <FormField label="Notas">
          <textarea
            className="input"
            style={{ resize: 'vertical', minHeight: 60, width: '100%' }}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
          />
        </FormField>
        <div className="flex justify-end gap-2 mt-2">
          <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
          <PrimaryBtn type="submit" disabled={saving}>
            {saving ? 'A guardar…' : 'Adicionar'}
          </PrimaryBtn>
        </div>
      </form>
    </Modal>
  );
}
