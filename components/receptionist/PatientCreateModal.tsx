import type { ChangeEvent } from 'react';
import SchemaFieldInput, { fieldLabel, type SchemaField } from '@/components/shared/SchemaFieldInput';
import { FormField, GhostBtn, Inp, Modal, PrimaryBtn } from '@/components/ui';

export interface NewPatientForm {
  name: string;
  dob: string;
  phone: string;
  email: string;
  insurance: string;
  alerts: string;
}

export default function PatientCreateModal({
  form,
  onChange,
  customFields,
  onCustomFieldsChange,
  schemaFields,
  error,
  saving,
  onSave,
  onClose,
}: {
  form: NewPatientForm;
  onChange: (form: NewPatientForm) => void;
  customFields: Record<string, unknown>;
  onCustomFieldsChange: (fields: Record<string, unknown>) => void;
  schemaFields: SchemaField[];
  error: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Registar doente" onClose={onClose} width={520}>
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
        <FormField label="Nome completo *">
          <Inp
            value={form.name}
            placeholder="Maria Silva"
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, name: e.target.value })}
          />
        </FormField>
        <FormField label="Data de nascimento">
          <input
            type="date"
            className="input"
            value={form.dob}
            onChange={(e) => onChange({ ...form, dob: e.target.value })}
          />
        </FormField>
        <FormField label="Telefone">
          <Inp
            value={form.phone}
            placeholder="912 345 678"
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, phone: e.target.value })}
          />
        </FormField>
        <FormField label="Email">
          <Inp
            type="email"
            value={form.email}
            placeholder="doente@email.com"
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, email: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label="Seguro">
        <Inp
          value={form.insurance}
          placeholder="Multicare"
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, insurance: e.target.value })}
        />
      </FormField>
      <FormField label="Alertas clínicos" hint="Separe múltiplos alertas com vírgulas">
        <Inp
          value={form.alerts}
          placeholder="Alergia a penicilina, Diabetes tipo 2"
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, alerts: e.target.value })}
        />
      </FormField>

      {schemaFields.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bg-sunken)' }}>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--text-primary)',
              marginBottom: 12,
            }}
          >
            Campos adicionais
          </div>
          <div className="grid-pair" style={{ gap: 12 }}>
            {schemaFields.map((f) => (
              <FormField key={f.id} label={`${fieldLabel(f)}${f.required ? ' *' : ''}`}>
                <SchemaFieldInput
                  field={f}
                  value={customFields[f.field_name]}
                  onChange={(v) => onCustomFieldsChange({ ...customFields, [f.field_name]: v })}
                />
              </FormField>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
            Configurado pelo administrador nos campos de schema.
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <PrimaryBtn onClick={onSave} disabled={saving || !form.name}>
          {saving ? 'A registar…' : 'Registar doente'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
      </div>
    </Modal>
  );
}
