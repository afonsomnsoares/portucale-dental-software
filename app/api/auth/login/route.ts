import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { appendAudit } from '@/lib/audit';
import { getDummyPasswordHash, signToken } from '@/lib/auth';
import { SESSION_MAX_AGE } from '@/lib/constants';
import { queryOne, withSystemContext } from '@/lib/db';
import { effectiveActions } from '@/lib/permissions';
import { clientIpIsTrustworthy, getClientIp } from '@/lib/rateLimit';
import { peekRateLimitShared, rateLimitShared } from '@/lib/rateLimitShared';
import { withRoute } from '@/lib/route';
import { asEmail } from '@/lib/validate';

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

// ─── O travão que não depende do IP ─────────────────────────────────────────
// Os dois limites acima têm o IP na chave, e o IP vem de um cabeçalho que quem
// chama escreve (ver getClientIp em lib/rateLimit.ts). Enquanto este limite não
// existiu, isso queria dizer que o travão do login não travava nada: bastava mudar
// o X-Forwarded-For a cada pedido para ter um balde novo de cada vez — incluindo no
// `login:acct:${ip}:${email}`, que apesar do nome nunca foi por conta, era por par
// (endereço, conta). Adivinhar passwords contra uma conta conhecida ficava limitado
// só pelo custo do bcrypt.
//
// Este é por CONTA e mais nada, por isso vale independentemente de quantos endereços
// alguém finja ter.
//
// ─── Conta só as FALHAS, e porquê ───────────────────────────────────────────
// Um contador que incrementasse em todas as tentativas gastaria orçamento a quem
// escreve a password certa — quem entra dez vezes num dia de trabalho ficaria mais
// perto do limite do que quem anda a adivinhar. Contando só falhas, quem sabe a
// password nunca o vê.
//
// ─── O que se perde, e porque é que não se perde sempre ─────────────────────
// Quem atacar pode gastar de propósito o orçamento de falhas de uma conta alheia e
// deixá-la sem login até a janela fechar. Num sistema com travão por IP a funcionar
// isso é caro — é preciso um endereço atribuível por rajada — e o preço aceita-se.
//
// Só que os dois limites acima têm o IP na chave, e esse IP só é atribuível quando
// existe um proxy declarado (`TRUSTED_PROXY_HOPS`). Na configuração por omissão —
// que é a que o docker-compose.yml deste repositório monta, a app publicada
// diretamente na 3000 — não existe: quem rode o X-Forwarded-For tem um balde novo a
// cada pedido. Recusar por conta nessas condições trocava adivinhação de passwords
// por uma coisa pior e mais barata: a ~2 pedidos por minuto por conta, todas as
// contas da clínica ficavam trancadas para sempre, e o audit registava só o endereço
// forjado.
//
// Por isso a recusa por conta está condicionada a haver um IP de confiança. Sem ele,
// o orçamento continua a ser contado e gasto — o sinal fica gravado na mesma — mas o
// que acontece ao exceder é um ATRASO e não uma porta fechada. Atrasar degrada quem
// adivinha sem nunca impedir quem sabe a password de entrar, que é exatamente a
// assimetria que falta quando não se consegue distinguir os dois pelo endereço.
const PER_EMAIL_LIMIT = { limit: 25, windowMs: 15 * 60 * 1000 };
const perEmailKey = (email: string) => (email ? `login:email:${email}` : null);

// Um segundo. Chega para levar a cadência de adivinhação de ~10/s para ~1/s por
// conta, e é imperceptível para quem se enganou a escrever e vai tentar outra vez.
// Deliberadamente fixo e não exponencial: um atraso que cresce sem teto é uma ligação
// presa a mais por cada tentativa, e transforma o travão no alvo.
const OVER_BUDGET_DELAY_MS = 1000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Gasta uma unidade do orçamento por conta. Chamada nos DOIS caminhos de falha —
// conta inexistente e password errada — para que continuem indistinguíveis um do
// outro, que é o que test/integration/login-oracle.test.ts fixa.
async function registerFailedAttempt(emailKey: string | null) {
  if (emailKey) await rateLimitShared(emailKey, PER_EMAIL_LIMIT);
}

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
  // ─── Normalizado ANTES de tudo, e com a MESMA função que usa quem grava ────
  // `asEmail` faz trim + lowercase, e é exatamente o que app/api/users/route.ts e
  // scripts/create-admin.ts aplicam ao INSERIR. Enquanto isto não estava aqui, a
  // consulta abaixo era `WHERE u.email=$1` com o que a pessoa escreveu — e como as
  // duas pontas discordavam, qualquer maiúscula devolvia 401 com a password certa.
  // Não é um caso de laboratório: os teclados de telemóvel capitalizam a primeira
  // letra por omissão, e um espaço colado num copy-paste faz o mesmo.
  //
  // Um email malformado dá '' em vez de rebentar: nenhuma linha corresponde, o
  // caminho do bcrypt de mitigação de timing abaixo corre na mesma, e a resposta é o
  // 401 indistinguível de sempre — em vez de um 500 que revelaria a diferença.
  const email = asEmail(body.email) || '';
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
  // O de email é lido sem incrementar — só as falhas lá abaixo é que o gastam.
  const emailKey = perEmailKey(email);
  const [perAccount, perIp, perEmail] = await Promise.all([
    rateLimitShared(`login:acct:${ip}:${email}`, PER_ACCOUNT_LIMIT),
    rateLimitShared(`login:ip:${ip}`, PER_IP_LIMIT),
    emailKey ? peekRateLimitShared(emailKey, PER_EMAIL_LIMIT) : Promise.resolve(null),
  ]);
  // ─── Recusar por conta só com um IP atribuível ────────────────────────────
  // Ver o comentário do PER_EMAIL_LIMIT acima. Sem proxy declarado, exceder o
  // orçamento por conta atrasa em vez de barrar: quem sabe a password entra na mesma,
  // só que um segundo mais tarde, e quem adivinha perde uma ordem de grandeza de
  // cadência. O atraso fica AQUI, antes de olhar para a base de dados, para se
  // aplicar por igual a contas existentes e inexistentes — pô-lo só nos caminhos de
  // falha tornava-o um oráculo de enumeração, que é o que o bcrypt de mitigação mais
  // abaixo existe para não haver.
  const perEmailBlocks = perEmail && !perEmail.ok;
  if (perEmailBlocks && !clientIpIsTrustworthy()) await delay(OVER_BUDGET_DELAY_MS);

  // O primeiro que barrar decide a resposta. A ordem entre eles não é observável de
  // fora — o corpo e o estado são os mesmos — e serve só para o retryAfterMs devolvido
  // ser o do limite que realmente barrou.
  const rl = [clientIpIsTrustworthy() ? perEmail : null, perAccount, perIp].find((r) => r && !r.ok);
  if (rl) {
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
    await registerFailedAttempt(emailKey);
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
    await registerFailedAttempt(emailKey);
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
    maxAge: SESSION_MAX_AGE,
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
