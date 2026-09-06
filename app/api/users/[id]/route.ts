import bcrypt from 'bcryptjs';
import type { NextRequest } from 'next/server';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { asEmail } from '@/lib/validate';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const authUser = getAuth(request);
  if (!authUser) return unauthorized();
  if (authUser.role !== 'admin' && authUser.role !== 'super_admin') return forbidden();
  if (!(await hasPermission(authUser, 'users:manage'))) return forbidden();

  const { id } = await params;
  const targetId = id;
  const { email, password, name, role, clinic, tenantId: bodyTenantId, active, specialties } = await request.json();

  if (!email || !name || !role) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const normalizedEmail = asEmail(email);
  if (!normalizedEmail) return Response.json({ error: 'Invalid email format' }, { status: 400 });
  if (password && String(password).length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }

  try {
    const existing = await queryOne(`SELECT id, role, tenant_id FROM users WHERE id=$1`, [targetId]);
    if (!existing) return Response.json({ error: 'User not found' }, { status: 404 });
    // A tenant-scoped admin may only manage users inside their own tenant — without this,
    // any clinic admin could edit (and reset the password of) a user in another clinic,
    // including that clinic's own admin, by guessing/enumerating a user id.
    if (authUser.tenantId && existing.tenant_id !== authUser.tenantId) {
      await logBlockedAccess(authUser, `User update blocked: cross-tenant target ${targetId}`);
      return forbidden();
    }
    const existingRole = existing.role;
    // super_admin is never settable through this endpoint — the platform has exactly
    // one, created only via scripts/create-admin.ts.
    if (role === 'super_admin') {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }
    // Existing super_admin's role can't be changed here at all (self-edit of other
    // fields — name/email/password/active — is still allowed; see the cross-tenant
    // guard above, which already confines everyone else to their own tenant and so
    // can never reach the super_admin's row in the first place).
    // Granting or revoking clinic-admin status is a super_admin-only action, symmetric
    // with POST /api/users — a clinic admin can't promote a colleague to admin, and
    // can't demote one away from admin either.
    if (existingRole === 'super_admin') {
      // roleToSave forced below regardless of what was requested.
    } else if (
      role !== existingRole &&
      (role === 'admin' || existingRole === 'admin') &&
      authUser.role !== 'super_admin'
    ) {
      return Response.json({ error: 'Only a super_admin can grant or revoke admin status' }, { status: 400 });
    }
    const roleToSave = existingRole === 'super_admin' ? 'super_admin' : role;

    let rows: Awaited<ReturnType<typeof query>>;
    // Tenant-scoped admins can't move a user to a different tenant; only the
    // super_admin (no tenantId) may set an arbitrary tenantId.
    const tId = authUser.tenantId ? existing.tenant_id : bodyTenantId || null;
    // Every role reachable here other than super_admin is tenant-scoped by construction
    // (users_role_tenant_consistency) — surface a clean 400 instead of a raw constraint
    // violation when the super_admin forgets to pass a tenantId.
    if (roleToSave !== 'super_admin' && !tId) {
      return Response.json({ error: 'tenantId is required' }, { status: 400 });
    }
    const cName = clinic || 'Main Clinic';
    const isActive = active !== false;
    // Only meaningful for role='dentist' (see lib/scheduling.ts's requiredSpecialty
    // matching) but harmless to store for anyone — the scheduling engine only ever reads
    // it for dentists in the first place.
    const specialtyList = Array.isArray(specialties)
      ? specialties.map((s: unknown) => String(s).trim()).filter((s: string) => !!s && s.length <= 100)
      : undefined;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      rows = await query(
        `UPDATE users SET email=$1, name=$2, role=$3, clinic=$4, tenant_id=$5, active=$6, password=$7,
                specialties=COALESCE($9::text[], specialties)
         WHERE id=$8 RETURNING id, email, name, role, clinic, active`,
        [
          normalizedEmail,
          String(name).trim().slice(0, 200),
          roleToSave,
          cName,
          tId,
          isActive,
          hashedPassword,
          targetId,
          specialtyList,
        ],
      );
    } else {
      rows = await query(
        `UPDATE users SET email=$1, name=$2, role=$3, clinic=$4, tenant_id=$5, active=$6,
                specialties=COALESCE($8::text[], specialties)
         WHERE id=$7 RETURNING id, email, name, role, clinic, active`,
        [normalizedEmail, String(name).trim().slice(0, 200), roleToSave, cName, tId, isActive, targetId, specialtyList],
      );
    }

    if (!rows.length) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const updatedUser = rows[0];

    const [withTenant] = await query(
      `SELECT u.id, u.email, u.name, u.role, u.clinic, u.active, u.created_at, u.tenant_id, u.specialties, t.name as tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [updatedUser.id],
    );

    await appendAudit(
      authUser,
      'UPDATE',
      `User Profile — ${updatedUser.email}`,
      null,
      updatedUser.role,
      authUser.clinic,
    );
    return Response.json(withTenant, { status: 200 });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      // unique violation
      return Response.json({ error: 'Email already exists' }, { status: 409 });
    }
    return Response.json({ error: 'Database error' }, { status: 500 });
  }
}
