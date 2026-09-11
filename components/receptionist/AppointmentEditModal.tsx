'use client';
import type { ChangeEvent, ReactNode } from 'react';
import { GhostBtn, Inp, Modal, PrimaryBtn, Sel, Textarea } from '@/components/ui';

export interface AppointmentEditForm {
  date: string;
  startTime: string;
  duration: number | string;
  chair: number | string;
  dentistId: string;
  type: string;
  notes: string;
}

interface Dentist {
  id: string;
  name: string;
}

interface AppointmentEditModalProps {
  open: boolean;
  onClose: () => void;
  dentists: Dentist[];
  value: AppointmentEditForm;
  onChange: (v: AppointmentEditForm) => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: children is always the form control (Inp/Sel/Textarea) passed by the caller */}
      <label>
        <span className="section-label block mb-1.5">{label}</span>
        {children}
      </label>
    </div>
  );
}

export default function AppointmentEditModal({
  open,
  onClose,
  dentists,
  value,
  onChange,
  onSave,
  saving,
  error,
}: AppointmentEditModalProps) {
  if (!open) return null;
  return (
    <Modal title="Editar consulta" onClose={onClose} width={560}>
      {error && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            border: '1px solid var(--urgency-critical-border)',
            color: 'var(--urgency-critical)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 12px',
            fontSize: 'var(--text-xs)',
            marginBottom: 12,
            fontWeight: 'var(--weight-bold)',
          }}
        >
          {error}
        </div>
      )}
      <div className="grid-pair" style={{ gap: 12 }}>
        <FormRow label="Data">
          <Inp
            type="date"
            value={value.date}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, date: e.target.value })}
          />
        </FormRow>
        <FormRow label="Hora">
          <Inp
            type="time"
            value={value.startTime}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, startTime: e.target.value })}
          />
        </FormRow>
        <FormRow label="Duração (min)">
          <Inp
            type="number"
            min={5}
            step={5}
            value={value.duration}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, duration: e.target.value })}
          />
        </FormRow>
        <FormRow label="Cadeira">
          <Inp
            type="number"
            min={1}
            value={value.chair}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, chair: e.target.value })}
          />
        </FormRow>
      </div>

      <FormRow label="Dentista">
        <Sel value={value.dentistId || ''} onChange={(e) => onChange({ ...value, dentistId: e.target.value })}>
          <option value="">— Select —</option>
          {dentists.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Sel>
      </FormRow>

      <FormRow label="Tipo">
        <Inp
          value={value.type}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, type: e.target.value })}
        />
      </FormRow>

      <FormRow label="Notas">
        <Textarea
          value={value.notes || ''}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...value, notes: e.target.value })}
        />
      </FormRow>

      <div className="flex gap-3 mt-3">
        <PrimaryBtn onClick={onSave} disabled={saving} style={{ justifyContent: 'center' }}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
      </div>
    </Modal>
  );
}
