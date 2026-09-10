import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { withRoute } from '@/lib/route';

// Emite o cookie CSRF que requireSameOrigin() confere depois em cada mutação.
// Público por obrigação: é preciso tê-lo ANTES de haver sessão, senão não havia
// como submeter o formulário de login.
export const GET = withRoute({ public: true }, async () => {
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
});
