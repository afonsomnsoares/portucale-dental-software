// Pure helper — no DB imports, so it's unit-testable the same way as
// lib/lifecycleCalc.ts. Deliberately checks only real `patients` columns
// (phone, email, dob) plus tenant-defined required custom fields — the
// Patient type also declares nif/address/postal_code/city/country/
// data_consent_* fields, but none of those are backed by an actual DB
// column anywhere in scripts/schema.sql or scripts/migrations/ (confirmed
// by grep), so checking them here would just report noise no route can
// ever satisfy.

export interface MissingDataPatientSignals {
  phone: string | null;
  email: string | null;
  dob: string | null;
  custom_fields: Record<string, unknown> | null;
}

export interface RequiredSchemaField {
  field_name: string;
  label?: string | null;
  required: boolean;
  rollout?: number | null;
}

export interface MissingField {
  field: string;
  label: string;
}

const CORE_FIELDS: Array<{ field: 'phone' | 'email' | 'dob'; label: string }> = [
  { field: 'phone', label: 'Telefone' },
  { field: 'email', label: 'Email' },
  { field: 'dob', label: 'Data de nascimento' },
];

// Only fields fully rolled out (rollout=100) are enforced — matches the
// existing convention in app/dashboard/*/patients/page.tsx, which filters
// schemaFields the same way before treating them as required at creation.
export function findMissingFields(
  patient: MissingDataPatientSignals,
  requiredSchemaFields: RequiredSchemaField[] = [],
): MissingField[] {
  const missing: MissingField[] = [];
  for (const { field, label } of CORE_FIELDS) {
    if (!patient[field]) missing.push({ field, label });
  }
  const custom = patient.custom_fields && typeof patient.custom_fields === 'object' ? patient.custom_fields : {};
  for (const f of requiredSchemaFields) {
    if (!f.required || Number(f.rollout || 0) !== 100) continue;
    const v = custom[f.field_name];
    if (v === undefined || v === null || v === '') {
      missing.push({ field: f.field_name, label: f.label || f.field_name });
    }
  }
  return missing;
}
