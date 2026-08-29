import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export async function GET() {
  const token = crypto.randomBytes(32).toString('base64url');
  const cookieStore = await cookies();
  cookieStore.set('dent_csrf', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return Response.json({ ok: true });
}
