import type { ChangeEvent } from 'react';
import { Inp, Sel } from '@/components/ui';

export interface SchemaField {
  id: number;
  field_name: string;
  label?: string | null;
  field_type: string;
  enum_values?: unknown;
  rollout?: number;
  required?: boolean;
}

export function fieldLabel(f: SchemaField) {
  return f.label || f.field_name;
}

export function fieldOptions(f: SchemaField): unknown[] {
  if (!f.enum_values) return [];
  if (Array.isArray(f.enum_values)) return f.enum_values;
  if (typeof f.enum_values === 'object') return Object.values(f.enum_values);
  return [];
}

// Renders the right input control for a dynamic schema_fields row (patient registration
// "Extra Fields") based on its field_type — shared between the receptionist and dentist
// patient pages, which both build a form from the same tenant schema.
export default function SchemaFieldInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const t = String(field.field_type || 'string');
  if (t === 'boolean') {
    return (
      <Sel value={String(!!value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="false">No</option>
        <option value="true">Yes</option>
      </Sel>
    );
  }
  if (t === 'enum') {
    const opts = fieldOptions(field);
    return (
      <Sel value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {opts.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </Sel>
    );
  }
  if (t === 'integer') {
    return (
      <Inp
        type="number"
        value={value ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }
  if (t === 'decimal') {
    return (
      <Inp
        type="number"
        step="0.01"
        value={value ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }
  return (
    <Inp
      value={value ?? ''}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder={t}
    />
  );
}
