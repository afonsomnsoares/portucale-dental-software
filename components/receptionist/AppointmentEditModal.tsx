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
    <Modal title="Edit appointment" onClose={onClose} width={560}>
      {error && (
        <div
          style={{
            background: '#FFEBE6',
            border: '1px solid #FFBDAD',
            color: '#DE350B',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 12,
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormRow label="Date">
          <Inp
            type="date"
            value={value.date}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, date: e.target.value })}
          />
        </FormRow>
        <FormRow label="Time">
          <Inp
            type="time"
            value={value.startTime}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, startTime: e.target.value })}
          />
        </FormRow>
        <FormRow label="Duration (min)">
          <Inp
            type="number"
            min={5}
            step={5}
            value={value.duration}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, duration: e.target.value })}
          />
        </FormRow>
        <FormRow label="Chair">
          <Inp
            type="number"
            min={1}
            value={value.chair}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, chair: e.target.value })}
          />
        </FormRow>
      </div>

      <FormRow label="Dentist">
        <Sel value={value.dentistId || ''} onChange={(e) => onChange({ ...value, dentistId: e.target.value })}>
          <option value="">— Select —</option>
          {dentists.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Sel>
      </FormRow>

      <FormRow label="Type">
        <Inp
          value={value.type}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, type: e.target.value })}
        />
      </FormRow>

      <FormRow label="Notes">
        <Textarea
          value={value.notes || ''}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...value, notes: e.target.value })}
        />
      </FormRow>

      <div className="flex gap-3 mt-3">
        <PrimaryBtn onClick={onSave} disabled={saving} style={{ justifyContent: 'center' }}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
      </div>
    </Modal>
  );
}
