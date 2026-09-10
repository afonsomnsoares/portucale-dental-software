import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { appendAudit } from '@/lib/audit';
import { getDummyPasswordHash, signToken } from '@/lib/auth';
import { queryOne, withSystemContext } from '@/lib/db';
import { effectiveActions } from '@/lib/permissions';
import { getClientIp } from '@/lib/rateLimit';
import { rateLimitShared } from '@/lib/rateLimitShared';
import { withRoute } from '@/lib/route';

// Compared against when no user matches the submitted email, so the unknown-email and
// wrong-password paths both pay one full bcrypt verification. The response bodies were
// already identical ('Invalid credentials', 401) — the leak was in the timing: skipping
// bcrypt.compare returned in ~0ms against ~100ms for a real user, which is a reliable
// oracle for "does this email have an account here". For a dental clinic that is
// patient- and staff-identifying information, not just an account-existence detail.
//
// A real bcrypt hash (cost 10, matching app/api/users/route.ts) of a passphrase nothing
// can be registered with — compare() must do the actual key derivation for the timing to
// match, so a made-up string here would be rejected as malformed and return instantly,
// reintroducing the very gap this closes.
// O hash é gerado em runtime por getDummyPasswordHash() (lib/auth.ts).
const PER_ACCOUNT_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };
const PER_IP_LIMIT = { limit: 50, windowMs: 60 * 60 * 1000 };

// Público por definição: é a rota que cria a sessão, logo não pode exigir uma.
// O same-origin/CSRF continua a valer (withRoute aplica-o a tudo o que não declare
// `crossOrigin`), e é por isso que existe GET /api/auth/csrf — para o formulário
// de login ter o par de cookie+cabeçalho antes de haver sessão nenhuma.
export const POST = withRoute({ public: true }, async ({ request }) => {
  // Corpo malformado é erro do cliente (400), não do servidor (500).
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const email = String(body.email || '');
  // Normalizada aqui, uma vez, para os DOIS caminhos de bcrypt.compare abaixo.
  // Enquanto só o caminho do email desconhecido a normalizava, um pedido sem
  // password devolvia 500 numa conta existente e 401 numa inexistente — um
  // oráculo de enumeração de contas muito mais fácil de explorar do que o canal
  // de timing que o getDummyPasswordHash() existe para fechar.
  const password = String(body.password || '');
  const ip = getClientIp(request);

  // Contadores no Postgres, não em memória: em memória cada instância tem o seu
  // balde, e com duas instâncias o travão do login deixa de travar. Ver
  // lib/rateLimitShared.ts.
  const [perAccount, perIp] = await Promise.all([
    rateLimitShared(`login:acct:${ip}:${email.toLowerCase()}`, PER_ACCOUNT_LIMIT),
    rateLimitShared(`login:ip:${ip}`, PER_IP_LIMIT),
  ]);
  const rl = !perAccount.ok ? perAccount : perIp;
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
    // Burn the same work a real verification would cost before answering — see
    // getDummyPasswordHash() above. The result is discarded (it is always false); it is
    // awaited purely so the two failure paths take comparable time.
    await bcrypt.compare(password, getDummyPasswordHash());
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
      // Ações efetivas do próprio: a Sidebar usa-as para esconder as entradas que a pessoa
      // não pode usar. Antes decidia só pelo papel, pelo que os overrides por clínica não
      // tinham efeito nenhum no menu (link visível a levar a um 403).
      // Sob withSystemContext como a leitura de `users` acima: role_permissions está sob
      // RLS (scripts/migrations/011_row_level_security.sql) e neste ponto ainda não há
      // contexto de tenant — getAuth() só corre nos pedidos seguintes. Sem isto a query
      // devolvia zero linhas, os overrides da clínica eram silenciosamente ignorados e o
      // menu logo após o login mostrava entradas que a clínica tinha retirado.
      permissions: await withSystemContext(() => effectiveActions(user.role, user.tenant_id)),
    },
  });
});
