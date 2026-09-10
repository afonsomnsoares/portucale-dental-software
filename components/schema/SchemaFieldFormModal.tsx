import type { ChangeEvent } from 'react';
import { FormField, GhostBtn, Inp, Modal, PrimaryBtn, Sel } from '@/components/ui';

export interface SchemaFieldForm {
  fieldName: string;
  label: string;
  description: string;
  fieldType: string;
  enumText: string;
  required: boolean;
}

export default function SchemaFieldFormModal({
  editingId,
  form,
  onChange,
  onSave,
  saving,
  onClose,
}: {
  editingId: number | null;
  form: SchemaFieldForm;
  onChange: (form: SchemaFieldForm) => void;
  onSave: () => void;
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={editingId ? 'Edit Field' : 'Add Field'} onClose={onClose}>
      <FormField label="Nome do campo (snake_case)">
        <Inp
          placeholder="tobacco_use"
          value={form.fieldName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, fieldName: e.target.value })}
          disabled={!!editingId}
        />
      </FormField>
      <FormField label="Rótulo">
        <Inp
          placeholder="Tabagismo"
          value={form.label}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, label: e.target.value })}
        />
      </FormField>
      <FormField label="Descrição">
        <Inp
          placeholder="Aparece no registo de doentes"
          value={form.description}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, description: e.target.value })}
        />
      </FormField>
      <FormField label="Tipo">
        <Sel
          value={form.fieldType}
          onChange={(e) =>
            onChange({ ...form, fieldType: e.target.value, enumText: e.target.value === 'enum' ? form.enumText : '' })
          }
        >
          {['string', 'boolean', 'integer', 'decimal', 'enum', 'uuid_ref'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Sel>
      </FormField>
      {form.fieldType === 'enum' && (
        <FormField label="Opções (separadas por vírgula)">
          <Inp
            placeholder="Nunca, Às vezes, Diariamente"
            value={form.enumText}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...form, enumText: e.target.value })}
          />
        </FormField>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <input
          type="checkbox"
          id="req"
          checked={form.required}
          onChange={(e) => onChange({ ...form, required: e.target.checked })}
          style={{ width: 16, height: 16 }}
        />
        <label htmlFor="req" style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
          Required
        </label>
      </div>
      <div className="flex gap-3">
        <PrimaryBtn onClick={onSave} disabled={saving || !form.fieldName}>
          {saving ? 'Saving…' : editingId ? 'Save' : 'Add'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
      </div>
    </Modal>
  );
}
