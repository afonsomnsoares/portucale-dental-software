import crypto from 'node:crypto';
import type { SessionUser } from './auth';
import { query } from './db';

export function hashEntry(data: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
}

export async function appendAudit(
  user: Pick<SessionUser, 'name' | 'role' | 'clinic'>,
  action: string,
  resource: string,
  before: unknown = null,
  after: unknown = null,
  clinic: string | null = null,
) {
  const entry: Record<string, unknown> = {
    user_name: user.name,
    user_role: user.role,
    clinic: clinic || user.clinic || 'Tower',
    action,
    resource,
    before_val: before ? String(before) : null,
    after_val: after ? String(after) : null,
  };
  entry.hash = hashEntry(entry);
  await query(
    `INSERT INTO audit_log (user_name, user_role, clinic, action, resource, before_val, after_val, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.user_name,
      entry.user_role,
      entry.clinic,
      entry.action,
      entry.resource,
      entry.before_val,
      entry.after_val,
      entry.hash,
    ],
  );
}

// Records a blocked access attempt (cross-tenant IDOR probe, forbidden write, ...)
// so an admin reviewing audit_log can spot someone poking at data that isn't theirs.
// Kept separate from appendAudit's before/after-value shape since there's no "after"
// state here — the request was rejected before it changed anything.
export async function logBlockedAccess(
  user: Pick<SessionUser, 'name' | 'role' | 'clinic'> | null | undefined,
  reason: string,
) {
  await appendAudit(
    user || { name: 'Unknown', role: 'anonymous', clinic: 'System' },
    'FORBIDDEN',
    reason,
    null,
    'blocked',
    user?.clinic || 'System',
  );
}

export async function appendTimeline(
  patientId: string,
  user: Pick<SessionUser, 'name' | 'role'>,
  eventType: string,
  event: string,
) {
  const h = hashEntry({ patientId, event, user: user.name, ts: Date.now() });
  await query(
    `INSERT INTO patient_timeline (patient_id, user_name, user_role, event_type, event, hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [patientId, user.name, user.role, eventType, event, h],
  );
}
