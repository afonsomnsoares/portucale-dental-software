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

// Sibling of getOwnedPatient for client-supplied *user* ids — `assignedTo` on a
// task or incident, `dentistId` on an appointment or invoice. The foreign key
// only proves the row exists, not that it belongs to the caller's clinic, so
// without this a tenant can attach its records to another tenant's staff: the
// row stays invisible to that tenant (every list query filters on tenant_id),
// but it is still their name on our data, and the difference between "FK
// violation" and "created" is an existence oracle for user ids.
//
// `role` and `activeOnly` fold in the checks the appointment routes were
// already doing inline (`role='dentist' AND active=TRUE`), so those stop being
// a pattern each new route has to remember to copy correctly.
export async function getOwnedUser(
  userId: unknown,
  user: Pick<SessionUser, 'tenantId'>,
  { role, activeOnly = false }: { role?: string; activeOnly?: boolean } = {},
) {
  const id = String(userId || '');
  if (!id) return null;
  const conds = [`id=$1`, `($2::uuid IS NULL OR tenant_id=$2::uuid)`];
  const vals: unknown[] = [id, user.tenantId || null];
  if (role) {
    vals.push(role);
    conds.push(`role=$${vals.length}`);
  }
  if (activeOnly) conds.push('active=TRUE');
  return queryOne(`SELECT id, name, role, tenant_id FROM users WHERE ${conds.join(' AND ')}`, vals);
}
