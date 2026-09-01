import type { SessionUser } from './auth';
import { query, queryOne, warnSchemaGap } from './db';

export const PERMISSION_ACTIONS = [
  'patients:create',
  'patients:update',
  'appointments:create',
  'appointments:update',
  'appointments:cancel',
  'appointments:status',
  'treatments:create',
  'treatments:update',
  'treatments:delete',
  'uploads:create',
  'schema:manage',
  'users:manage',
  'tenants:manage',
  'audit:read',
  'reports:read',
  'permissions:manage',
  'jobs:run',
  'invoices:create',
  'invoices:read',
  'invoices:update',
  'invoices:pay',
  'finance:read',
  'recovery:read',
  'schedule:read',
  'waitlist:manage',
  'lifecycle:read',
  'notifications:read',
  'patient-tasks:read',
  'patient-tasks:create',
  'patient-tasks:update',
  'patient-interactions:read',
  'patient-interactions:create',
  'uploads:read',
  'lead-sources:manage',
  'staff-schedules:manage',
  'staff-time-off:manage',
  'checklists:manage',
  'incidents:manage',
  'inventory:manage',
  'equipment:manage',
  'patient-portal:manage',
];

const DEFAULT: Record<string, Set<string>> = {
  super_admin: new Set(PERMISSION_ACTIONS),
  admin: new Set(PERMISSION_ACTIONS),
  receptionist: new Set([
    'patients:create',
    'patients:update',
    'appointments:create',
    'appointments:update',
    'appointments:cancel',
    'appointments:status',
    'reports:read',
    'invoices:create',
    'invoices:read',
    'invoices:update',
    'invoices:pay',
    'finance:read',
    'recovery:read',
    'schedule:read',
    'waitlist:manage',
    'lifecycle:read',
    'notifications:read',
    'patient-tasks:read',
    'patient-tasks:create',
    'patient-tasks:update',
    'patient-interactions:read',
    'patient-interactions:create',
    'uploads:create',
    'uploads:read',
    'patient-portal:manage',
  ]),
  dentist: new Set([
    'appointments:status',
    'treatments:create',
    'treatments:update',
    'treatments:delete',
    'uploads:create',
    'uploads:read',
    'reports:read',
    'patient-tasks:read',
    'patient-tasks:create',
    'patient-tasks:update',
    'patient-interactions:read',
    'patient-interactions:create',
    'patient-portal:manage',
  ]),
};

export function defaultAllows(role: string, action: string) {
  const set = DEFAULT[String(role || '')];
  return !!set?.has(action);
}

async function safeQueryOne(sql: string, params: unknown[] = []) {
  try {
    return await queryOne(sql, params);
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      warnSchemaGap('permissions.role_permissions', e);
      return null;
    }
    throw e;
  }
}

async function safeQuery(sql: string, params: unknown[] = []) {
  try {
    return await query(sql, params);
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      warnSchemaGap('permissions.role_permissions', e);
      return [];
    }
    throw e;
  }
}

export async function permissionOverride(
  tenantId: string | null | undefined,
  role: string,
  action: string,
): Promise<boolean | null> {
  if (!tenantId) return null;
  const row = await safeQueryOne(`SELECT allowed FROM role_permissions WHERE tenant_id=$1 AND role=$2 AND action=$3`, [
    tenantId,
    role,
    action,
  ]);
  if (!row) return null;
  return !!row.allowed;
}

export async function hasPermission(user: Pick<SessionUser, 'role' | 'tenantId'> | null | undefined, action: string) {
  if (!user) return false;
  const role = String(user.role || '');
  if (role === 'super_admin') return true;
  const tenantId = user.tenantId || null;
  const override = await permissionOverride(tenantId, role, action);
  if (override !== null) return override;
  return defaultAllows(role, action);
}

export async function getPermissionMatrix(tenantId: string) {
  const roles = ['receptionist', 'dentist', 'admin'];
  const rows = await safeQuery(`SELECT role, action, allowed FROM role_permissions WHERE tenant_id=$1`, [tenantId]);
  const map = new Map(rows.map((r) => [`${r.role}:${r.action}`, !!r.allowed]));
  type PermEntry = { default: boolean; override: boolean | null; effective: boolean };
  const matrix: Record<string, Record<string, PermEntry>> = {};
  for (const role of roles) {
    matrix[role] = {};
    for (const action of PERMISSION_ACTIONS) {
      const key = `${role}:${action}`;
      const def = defaultAllows(role, action);
      const rawOvr = map.get(key);
      const ovr: boolean | null = rawOvr === undefined ? null : !!rawOvr;
      matrix[role][action] = {
        default: def,
        override: ovr,
        effective: ovr === null ? def : ovr,
      };
    }
  }
  return { roles, actions: PERMISSION_ACTIONS, matrix };
}

export async function setPermissionOverrides(
  tenantId: string,
  updates: Array<{ role?: unknown; action?: unknown; allowed?: unknown }> | null | undefined,
) {
  for (const u of updates || []) {
    const role = String(u.role || '');
    const action = String(u.action || '');
    if (!role || !action) continue;
    if (!PERMISSION_ACTIONS.includes(action)) continue;
    if (u.allowed === null) {
      await safeQuery(`DELETE FROM role_permissions WHERE tenant_id=$1 AND role=$2 AND action=$3`, [
        tenantId,
        role,
        action,
      ]);
    } else {
      await safeQuery(
        `INSERT INTO role_permissions (tenant_id, role, action, allowed)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, role, action)
         DO UPDATE SET allowed=EXCLUDED.allowed`,
        [tenantId, role, action, !!u.allowed],
      );
    }
  }
}
