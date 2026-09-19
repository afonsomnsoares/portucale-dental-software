import { cookies } from 'next/headers';
import { appendAudit } from '@/lib/audit';
import { getAuth } from '@/lib/auth';
import { revokeSession } from '@/lib/permissions';
import { withRoute } from '@/lib/route';

// Público de propósito: terminar sessão tem de funcionar mesmo com um token já
// inválido ou expirado — é precisamente aí que mais interessa apagar o cookie.
// O same-origin continua a ser verificado pelo withRoute, que corre antes disto.
//
// ─── Apagar o cookie não terminava a sessão ─────────────────────────────────
// Até à migração 064 era só isso que aqui acontecia. O token continuava assinado,
// dentro da validade e aceite por todas as rotas durante o que lhe faltasse de
// JWT_TTL_SECONDS — 7 dias por omissão. Apagar o cookie tira-o do browser de quem
// carregou no botão; não tira valor nenhum a uma cópia feita antes disso.
//
// A diferença importa no caso em que alguém carrega no botão de propósito: um posto
// partilhado na receção, um portátil emprestado, um separador esquecido num
// computador que não é dela. `revokeSession` grava o `jti` deste token em
// `revoked_sessions`, e lib/permissions.ts's revalidateSession passa a recusá-lo —
// só a ele, não às outras sessões da mesma pessoa.
export const POST = withRoute({ public: true }, async ({ request }) => {
  const user = getAuth(request);
  // Antes de apagar o cookie, e antes de qualquer outra coisa que possa falhar: é
  // esta a linha que faz o logout significar o que diz.
  const revoked = user ? await revokeSession(user) : false;
  const cookieStore = await cookies();
  cookieStore.delete('dent_token');
  if (user) {
    await appendAudit(
      { name: user.name, role: user.role, clinic: user.clinic },
      'AUTH',
      `Logout: ${user.id}`,
      null,
      // Distingue-se no registo porque as duas coisas são diferentes: 'success' é a
      // sessão terminada de facto, 'cookie_cleared' é o cookie apagado com o token
      // ainda válido até expirar (base por migrar, ou falha a gravar a revogação).
      // Um registo que chamasse o mesmo às duas escondia exatamente o que interessa.
      revoked ? 'success' : 'cookie_cleared',
      user.clinic,
    );
  }
  return Response.json({ success: true });
});
