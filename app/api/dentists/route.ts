import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireRoles, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin', 'super_admin', 'receptionist')) return forbidden();

  const rows = await query(
    `SELECT id, name, email, specialties
     FROM users
     WHERE role='dentist' AND active=TRUE AND tenant_id=$1
     ORDER BY name`,
    [user.tenantId],
  );

  return Response.json(rows);
}
