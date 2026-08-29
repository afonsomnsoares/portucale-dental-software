import type { SessionUser } from './auth';
import { queryOne } from './db';

// Confirms a patient exists and is visible to the caller: same tenant as the
// caller, or a super-admin (role=admin with no tenantId) who can see across
// all tenants. Call this before writing any record that references a
// client-supplied patientId (appointments, treatments, notes, prescriptions,
// uploads, ...) so one tenant can't attach data to another tenant's patient —
// see the IDOR fixes across app/api/* that call this.
export async function getOwnedPatient(patientId: unknown, user: Pick<SessionUser, 'tenantId'>) {
  const id = String(patientId || '');
  if (!id) return null;
  return queryOne(`SELECT id, name, tenant_id FROM patients WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    user.tenantId || null,
  ]);
}
