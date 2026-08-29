import bcrypt from 'bcryptjs';
import type { NextRequest } from 'next/server';
import { appendAudit, logBlockedAccess } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { asEmail } from '@/lib/validate';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const authUser = getAuth(request);
  if (!authUser) return unauthorized();
  if (authUser.role !== 'admin') return forbidden();
  if (!(await hasPermission(authUser, 'users:manage'))) return forbidden();

  const { id } = await params;
  const targetId = id;
  const { email, password, name, role, clinic, tenantId: bodyTenantId, active } = await request.json();

  if (!email || !name || !role) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const normalizedEmail = asEmail(email);
  if (!normalizedEmail) return Response.json({ error: 'Invalid email format' }, { status: 400 });
  if (password && String(password).length < 10) {
    return Response.json({ error: 'Password must be at least 10 characters' }, { status: 400 });
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
    if (existingRole !== 'admin' && role === 'admin') {
      return Response.json({ error: 'Cannot promote user to Super Admin' }, { status: 400 });
    }
    const roleToSave = existingRole === 'admin' ? 'admin' : role;

    let rows: Awaited<ReturnType<typeof query>>;
    // Tenant-scoped admins can't move a user to a different tenant; only a super-admin
    // (no tenantId) may set an arbitrary tenantId.
    const tId = authUser.tenantId ? existing.tenant_id : bodyTenantId || null;
    const cName = clinic || 'Main Clinic';
    const isActive = active !== false;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      rows = await query(
        `UPDATE users SET email=$1, name=$2, role=$3, clinic=$4, tenant_id=$5, active=$6, password=$7
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
        ],
      );
    } else {
      rows = await query(
        `UPDATE users SET email=$1, name=$2, role=$3, clinic=$4, tenant_id=$5, active=$6
         WHERE id=$7 RETURNING id, email, name, role, clinic, active`,
        [normalizedEmail, String(name).trim().slice(0, 200), roleToSave, cName, tId, isActive, targetId],
      );
    }

    if (!rows.length) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const updatedUser = rows[0];

    const [withTenant] = await query(
      `SELECT u.id, u.email, u.name, u.role, u.clinic, u.active, u.created_at, u.tenant_id, t.name as tenant_name 
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
