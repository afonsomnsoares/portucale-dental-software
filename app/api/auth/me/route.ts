import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = getAuth(request);
  if (!session) return unauthorized();

  const user = await queryOne(
    `SELECT u.id, u.email, u.name, u.role, u.clinic, u.tenant_id, u.active,
            t.name as tenant_name, t.city as tenant_city,
            COALESCE(t.operatories, 3) as operatories
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id=$1 AND u.active=TRUE`,
    [session.id],
  );

  if (!user) {
    const cookieStore = await cookies();
    cookieStore.delete('dent_token');
    return unauthorized();
  }

  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      clinic: user.clinic,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantCity: user.tenant_city,
      operatories: Number(user.operatories || 3),
    },
  });
}
