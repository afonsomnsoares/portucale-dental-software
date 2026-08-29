// Shared client-side domain types, mirrored from scripts/schema.sql + the
// fields each API route joins on (e.g. `patient_name`, `dentist_name`).
// Kept intentionally loose on nullability (DB columns are frequently
// nullable) rather than chasing 100% accuracy against the schema.
//
// Split by domain under lib/types/ — this file is a pure barrel re-export
// so every existing `import type {...} from '@/lib/types'` keeps working.

export * from './types/appointment';
export * from './types/audit';
export * from './types/billing';
export * from './types/consent';
export * from './types/dashboard';
export * from './types/finance-reports';
export * from './types/inventory';
export * from './types/lab-order';
export * from './types/lifecycle';
export * from './types/medical-history';
export * from './types/notes';
export * from './types/odontogram';
export * from './types/patient';
export * from './types/prescription';
export * from './types/recall';
export * from './types/recovery';
export * from './types/schedule-intel';
export * from './types/tenant';
export * from './types/treatment';
export * from './types/user';
