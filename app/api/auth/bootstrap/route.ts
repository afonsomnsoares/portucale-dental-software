import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { requireSameOrigin, signToken } from '@/lib/auth';
import { queryOne, withTransaction } from '@/lib/db';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export async function GET() {
  const row = await queryOne(`SELECT COUNT(*)::int AS n FROM users`);
  return Response.json({ needsBootstrap: (row?.n || 0) === 0 });
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;

  const { email, password, name } = await request.json();
  const ip = getClientIp(request);
  const rl = rateLimit(`bootstrap:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) {
    await appendAudit(
      { name: 'Unknown', role: 'anonymous', clinic: 'System' },
      'RATE_LIMIT',
      `Bootstrap rate limit exceeded from ${ip}`,
      null,
      'blocked',
      'System',
    );
    return Response.json(
      {
        error: 'Too many bootstrap attempts. Try again later.',
        code: 'RATE_LIMIT',
        details: { retryAfterMs: rl.retryAfterMs },
      },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  if (!email || !password || !name) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (String(password).length < 10) {
    return Response.json({ error: 'Password must be at least 10 characters' }, { status: 400 });
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM users`);
    if ((rows[0]?.n || 0) > 0) return { error: 'Bootstrap already completed', status: 409 };

    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password, name, role, clinic, tenant_id)
       VALUES ($1, $2, $3, 'admin', 'System', NULL)
       RETURNING id, email, name, role, clinic, tenant_id`,
      [email, hashedPassword, name],
    );
    return { user: userRows[0] };
  });

  if (result.error) return Response.json({ error: result.error }, { status: result.status });

  const token = signToken({
    id: result.user.id,
    name: result.user.name,
    role: result.user.role,
    clinic: result.user.clinic,
    tenantId: result.user.tenant_id,
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
    { name: result.user.name, role: result.user.role, clinic: result.user.clinic },
    'BOOTSTRAP',
    `Bootstrap Super Admin: ${result.user.email}`,
    null,
    'success',
    result.user.clinic,
  );

  return Response.json(
    {
      user: {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        clinic: result.user.clinic,
        tenantId: result.user.tenant_id,
        operatories: 3,
      },
    },
    { status: 201 },
  );
}
