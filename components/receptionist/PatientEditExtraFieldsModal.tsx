import SchemaFieldInput, { fieldLabel, type SchemaField } from '@/components/shared/SchemaFieldInput';
import { FormField, GhostBtn, Modal, PrimaryBtn } from '@/components/ui';

export default function PatientEditExtraFieldsModal({
  schemaFields,
  extraForm,
  onChange,
  saving,
  onSave,
  onClose,
}: {
  schemaFields: SchemaField[];
  extraForm: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Editar campos adicionais" onClose={onClose} width={560}>
      {schemaFields.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sem campos adicionais configurados.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {schemaFields.map((f) => (
            <FormField key={f.id} label={`${fieldLabel(f)}${f.required ? ' *' : ''}`}>
              <SchemaFieldInput
                field={f}
                value={extraForm[f.field_name]}
                onChange={(v) => onChange({ ...extraForm, [f.field_name]: v })}
              />
            </FormField>
          ))}
        </div>
      )}
      <div className="flex gap-3 mt-3">
        <PrimaryBtn onClick={onSave} disabled={saving} style={{ justifyContent: 'center' }}>
          {saving ? 'A guardar…' : 'Guardar'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Cancelar</GhostBtn>
      </div>
    </Modal>
  );
}
