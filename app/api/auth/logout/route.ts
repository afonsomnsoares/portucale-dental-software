import { cookies } from 'next/headers';
import { appendAudit } from '@/lib/audit';
import { getAuth } from '@/lib/auth';
import { withRoute } from '@/lib/route';

// Público de propósito: terminar sessão tem de funcionar mesmo com um token já
// inválido ou expirado — é precisamente aí que mais interessa apagar o cookie.
// O same-origin continua a ser verificado pelo withRoute, que corre antes disto.
export const POST = withRoute({ public: true }, async ({ request }) => {
  const user = getAuth(request);
  const cookieStore = await cookies();
  cookieStore.delete('dent_token');
  if (user) {
    await appendAudit(
      { name: user.name, role: user.role, clinic: user.clinic },
      'AUTH',
      `Logout: ${user.id}`,
      null,
      'success',
      user.clinic,
    );
  }
  return Response.json({ success: true });
});
