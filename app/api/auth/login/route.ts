import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { requireSameOrigin, signToken } from '@/lib/auth';
import { queryOne, withSystemContext } from '@/lib/db';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const { email, password } = await request.json();
  const ip = getClientIp(request);
  const rl = rateLimit(`login:${ip}:${String(email || '').toLowerCase()}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) {
    await appendAudit(
      { name: String(email || 'Unknown'), role: 'anonymous', clinic: 'System' },
      'RATE_LIMIT',
      `Login rate limit exceeded from ${ip}`,
      null,
      'blocked',
      'System',
    );
    return Response.json(
      {
        error: 'Too many login attempts. Try again later.',
        code: 'RATE_LIMIT',
        details: { retryAfterMs: rl.retryAfterMs },
      },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  // No session exists yet at this point, so there's nothing for lib/auth.ts's
  // getAuth() to have primed lib/db.ts's RLS tenant context with — this has to
  // search by email across every tenant by design, so it explicitly runs as
  // the system/super-admin context instead (see withSystemContext in lib/db.ts).
  const user = await withSystemContext(() =>
    queryOne(
      `SELECT u.id, u.email, u.password as hashed_password, u.name, u.role, u.clinic, u.tenant_id,
              t.name as tenant_name, t.city as tenant_city,
              COALESCE(t.operatories, 3) as operatories
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email=$1 AND u.active=TRUE`,
      [email],
    ),
  );

  if (!user) {
    await appendAudit(
      { name: String(email || 'Unknown'), role: 'anonymous', clinic: 'System' },
      'AUTH_FAIL',
      `Login: ${String(email || 'Unknown')}`,
      null,
      'invalid_credentials',
      'System',
    );
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const isValid = await bcrypt.compare(password, user.hashed_password);
  if (!isValid) {
    await appendAudit(
      { name: user.name, role: user.role, clinic: user.clinic },
      'AUTH_FAIL',
      `Login: ${user.email}`,
      null,
      'invalid_credentials',
      user.clinic,
    );
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = signToken({
    id: user.id,
    name: user.name,
    role: user.role,
    clinic: user.clinic,
    tenantId: user.tenant_id,
  });

  const cookieStore = await cookies();
  cookieStore.set('dent_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  await appendAudit(
    { name: user.name, role: user.role, clinic: user.clinic },
    'AUTH',
    `Login: ${user.email}`,
    null,
    'success',
    user.clinic,
  );

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
