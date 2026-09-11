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
  const asStr = (v: unknown): string => (v == null ? '' : String(v));
  const asNum = (v: unknown): number | string => {
    if (v == null) return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  };
  if (t === 'boolean') {
    return (
      <Sel value={String(!!value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </Sel>
    );
  }
  if (t === 'enum') {
    const opts = fieldOptions(field);
    return (
      <Sel value={asStr(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Selecionar —</option>
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
        value={asNum(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }
  if (t === 'decimal') {
    return (
      <Inp
        type="number"
        step="0.01"
        value={asNum(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }
  return (
    <Inp
      value={asStr(value)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder={t}
    />
  );
}
