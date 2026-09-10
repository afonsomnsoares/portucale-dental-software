import bcrypt from 'bcryptjs';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { asEmail } from '@/lib/validate';

// 'admin' here means a clinic admin (always tenant-scoped from here on — see
// scripts/migrations/017_super_admin_role.sql). 'super_admin' is deliberately never in
// this set: the platform has exactly one, created only via scripts/create-admin.ts.
const ALLOWED_ROLES = new Set(['receptionist', 'dentist', 'admin']);

export const GET = withRoute({ permission: 'users:manage', tenant: 'optional' }, async ({ user }) => {
  if (user.role !== 'admin' && user.role !== 'super_admin') return forbidden();

  // Tenant-scoped admins must only see their own clinic's staff — a null tenantId means
  // super-admin, which bypasses the filter and sees every tenant (same pattern as patients).
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.role, u.clinic, u.active, u.created_at, u.tenant_id, u.specialties, t.name as tenant_name
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
     ORDER BY u.created_at DESC`,
    [user.tenantId || null],
  );
  return Response.json(rows);
});

export const POST = withRoute({ permission: 'users:manage', tenant: 'optional' }, async ({ request, user }) => {
  if (user.role !== 'admin' && user.role !== 'super_admin') return forbidden();

  const { email, password, name, role, clinic, tenantId: bodyTenantId } = await request.json();

  if (!email || !password || !name || !role) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const normalizedEmail = asEmail(email);
  if (!normalizedEmail) return Response.json({ error: 'Invalid email format' }, { status: 400 });
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(String(role))) {
    // Also covers role==='super_admin': never created through this endpoint.
    return Response.json({ error: 'Invalid role' }, { status: 400 });
  }
  // Granting admin (clinic-admin) status is a super_admin-only action — a clinic admin
  // creating a peer admin in their own tenant is out of scope for now (see the decision
  // in scripts/migrations/017_super_admin_role.sql's header).
  if (role === 'admin' && user.role !== 'super_admin') {
    await logBlockedAccess(user, 'User creation blocked: only super_admin may create an admin');
    return forbidden();
  }

  // A tenant-scoped admin may only create users inside their own tenant — the request
  // body's tenantId is ignored for them. Only the super_admin (no tenantId) may target an
  // arbitrary tenant; without that guard a clinic admin could pass any tenantId to plant
  // a user in another clinic (privilege escalation / cross-tenant IDOR).
  let tenantId = user.tenantId;
  if (!tenantId) {
    tenantId = bodyTenantId || null;
  } else if (bodyTenantId && bodyTenantId !== tenantId) {
    await logBlockedAccess(user, `User creation blocked: attempted to target tenant ${bodyTenantId}`);
    return forbidden();
  }
  // Every role this endpoint can create is tenant-scoped by construction
  // (users_role_tenant_consistency) — surface a clean 400 instead of a raw constraint
  // violation when the super_admin forgets to pass a tenantId.
  if (!tenantId) {
    return Response.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [newUser] = await query(
      `INSERT INTO users (email, password, name, role, clinic, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, name, role, clinic, active, tenant_id`,
      [normalizedEmail, hashedPassword, String(name).trim().slice(0, 200), role, clinic || 'Main Clinic', tenantId],
    );

    await appendAudit(user, 'CREATE', `User — ${newUser.email}`, null, newUser.role, user.clinic);
    return Response.json(newUser, { status: 201 });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      // unique violation
      return Response.json({ error: 'Email already exists' }, { status: 409 });
    }
    return Response.json({ error: 'Database error' }, { status: 500 });
  }
});
