// ─── O ponto único por onde passam os 191 handlers ──────────────────────────
// A união discriminada de RouteOptions está verificada pelo compilador, e isso é
// metade do trabalho: `withRoute({}, handler)` não compila. A outra metade é
// comportamento em tempo de execução, e não havia uma linha a exercitá-la — nem os
// portões que correm antes de haver sessão, nem a resolução da clínica, que é a regra
// de que depende o âmbito de toda a aplicação.
//
// O que este ficheiro cobre corre SEM base de dados, de propósito: são os passos que
// acontecem antes de `authorize` (same-origin/CSRF, `public`, o 401) mais a função pura
// que decide a clínica. Os modos `permission` e `platform` revalidam a sessão contra a
// base e por isso vivem em test/integration/.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextRequest } from 'next/server';
import type { SessionUser } from '../lib/auth.ts';
import { scopeTenant } from '../lib/auth.ts';
import { __resetRateLimitStore } from '../lib/rateLimit.ts';
import { resolveTenantId, withRoute } from '../lib/route.ts';

process.env.JWT_SECRET ||= 'test-secret-para-route-aaaaaaaaaaaaaaaaaaaaaaaa';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function req(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: unknown;
}): NextRequest {
  const headers = new Headers(opts.headers);
  headers.set('host', 'localhost');
  const cookies = opts.cookies || {};
  const cookiePairs = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  if (cookiePairs.length) headers.set('cookie', cookiePairs.join('; '));
  const init: RequestInit = { method: opts.method || 'GET', headers };
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`http://localhost${opts.url || '/api/x'}`, init) as unknown as NextRequest;
}

const noParams = { params: Promise.resolve({}) };

// Um handler que nunca deve ser alcançado nos testes de portão: se for, a asserção
// falha onde interessa (o portão deixou passar) em vez de num efeito indireto.
function handlerThatMustNotRun() {
  return () => {
    assert.fail('o handler correu — o portão deixou passar um pedido que devia ter barrado');
  };
}

// ─── 1. Same-origin e CSRF ──────────────────────────────────────────────────
// Corre PRIMEIRO, antes de sequer se olhar para o token. É o passo que withRoute
// aplica a tudo o que não declare `crossOrigin`, e a razão de o declarar ser um campo
// em vez de uma ausência: uma exceção encontra-se com um grep.

test('uma mutação de outra origem é barrada antes de tudo o resto', async () => {
  const route = withRoute({ public: true }, handlerThatMustNotRun());
  const res = await route(
    req({ method: 'POST', headers: { origin: 'http://atacante.example' }, body: {} }),
    noParams,
  );
  assert.equal(res.status, 403);
});

test('uma mutação sem o par cookie+cabeçalho de CSRF é barrada', async () => {
  const route = withRoute({ public: true }, handlerThatMustNotRun());

  // Nenhum dos dois.
  assert.equal((await route(req({ method: 'POST', body: {} }), noParams)).status, 403);

  // Só o cookie — é isto que impede que um site terceiro, que consegue provocar o
  // pedido mas não LER o cookie, o consiga acompanhar do cabeçalho.
  const soCookie = req({ method: 'POST', cookies: { dent_csrf: 'abc123' }, body: {} });
  assert.equal((await route(soCookie, noParams)).status, 403);

  // Cabeçalho diferente do cookie.
  const naoBate = req({
    method: 'POST',
    cookies: { dent_csrf: 'abc123' },
    headers: { 'x-csrf-token': 'outro-valor' },
    body: {},
  });
  assert.equal((await route(naoBate, noParams)).status, 403);
});

test('uma leitura não precisa de CSRF — requireSameOrigin é no-op em GET', async () => {
  const route = withRoute({ public: true }, () => Response.json({ ok: true }));
  const res = await route(req({ method: 'GET' }), noParams);
  assert.equal(res.status, 200);
});

test('crossOrigin dispensa o par same-origin/CSRF, e só ele', async () => {
  const aberta = withRoute({ public: true, crossOrigin: true }, () => Response.json({ ok: true }));
  const res = await aberta(
    req({ method: 'POST', headers: { origin: 'http://formulario.example' }, body: {} }),
    noParams,
  );
  assert.equal(res.status, 200, 'as três rotas cross-origin não se autenticam por cookie — ver o comentário em lib/route.ts');

  // A mesma rota sem a declaração continua fechada. É esta assimetria que faz da
  // exceção uma decisão e não um descuido.
  const fechada = withRoute({ public: true }, handlerThatMustNotRun());
  const bloqueada = await fechada(
    req({ method: 'POST', headers: { origin: 'http://formulario.example' }, body: {} }),
    noParams,
  );
  assert.equal(bloqueada.status, 403);
});

// ─── 2. Autenticação ────────────────────────────────────────────────────────

test('sem sessão, uma rota não-pública responde 401 sem tocar na base de dados', async () => {
  const route = withRoute({ permission: 'patients:create' }, handlerThatMustNotRun());
  const res = await route(req({ method: 'GET' }), noParams);
  assert.equal(res.status, 401);
});

test('uma rota pública entrega ao handler sem utilizador e sem clínica', async () => {
  let visto: { user: unknown; tenantId: unknown } | null = null;
  const route = withRoute({ public: true }, ({ user, tenantId }) => {
    visto = { user, tenantId };
    return Response.json({ ok: true });
  });
  const res = await route(req({ method: 'GET' }), noParams);
  assert.equal(res.status, 200);
  assert.deepEqual(visto, { user: null, tenantId: '' });
});

// ─── 3. Resolução da clínica ────────────────────────────────────────────────
// A regra de que depende o âmbito de todas as consultas da aplicação.

const utilizadorDeClinica: SessionUser = { id: 'u1', name: 'Ana', role: 'admin', tenantId: TENANT_A };
const superAdmin: SessionUser = { id: 'u2', name: 'Rui', role: 'super_admin', tenantId: null };

test('quem tem clínica usa sempre a sua — o ?tenantId= é ignorado', () => {
  // Deixá-lo escolher outra seria um IDOR entre clínicas, e é por isso que a
  // precedência não é negociável em nenhuma das três políticas.
  for (const policy of ['required', 'optional', 'resolved'] as const) {
    const r = req({ url: `/api/x?tenantId=${TENANT_B}` });
    assert.equal(resolveTenantId(r, utilizadorDeClinica, policy, null), TENANT_A, `política '${policy}'`);
  }
});

test('nem pelo corpo do pedido', () => {
  const r = req({ method: 'POST', url: '/api/x', body: { tenantId: TENANT_B } });
  assert.equal(resolveTenantId(r, utilizadorDeClinica, 'resolved', { tenantId: TENANT_B }), TENANT_A);
});

test('o super-admin DENTRO de uma clínica resolve para essa clínica', () => {
  // O cookie acting_tenant é o "entrar na clínica" de POST /api/tenants/enter. É a
  // única forma de o super-admin ter uma clínica, porque a sua própria é sempre null
  // (users_role_tenant_consistency).
  const r = req({ cookies: { acting_tenant: TENANT_A } });
  for (const policy of ['required', 'optional', 'resolved'] as const) {
    assert.equal(resolveTenantId(r, superAdmin, policy, null), TENANT_A, `política '${policy}'`);
  }
});

test('a clínica em que ele entrou ganha ao ?tenantId= que passe à mão', () => {
  const r = req({ url: `/api/x?tenantId=${TENANT_B}`, cookies: { acting_tenant: TENANT_A } });
  assert.equal(resolveTenantId(r, superAdmin, 'resolved', null), TENANT_A);
});

test('o cookie é ignorado para quem não é super-admin', () => {
  const r = req({ cookies: { acting_tenant: TENANT_B } });
  assert.equal(resolveTenantId(r, utilizadorDeClinica, 'required', null), TENANT_A);
});

test('um acting_tenant que não seja um UUID não vale nada', () => {
  const r = req({ cookies: { acting_tenant: 'nao-e-um-uuid' } });
  assert.equal(resolveTenantId(r, superAdmin, 'optional', null), null);
});

test("'resolved' aceita a escolha do super-admin fora de qualquer clínica", () => {
  const porQuery = req({ url: `/api/x?tenantId=${TENANT_B}` });
  assert.equal(resolveTenantId(porQuery, superAdmin, 'resolved', null), TENANT_B);

  const porCorpo = req({ method: 'POST', body: { tenantId: TENANT_B } });
  assert.equal(resolveTenantId(porCorpo, superAdmin, 'resolved', { tenantId: TENANT_B }), TENANT_B);
});

test("'required' NÃO aceita essa escolha — e sem clínica responde 403", async () => {
  const r = req({ url: `/api/x?tenantId=${TENANT_B}` });
  const out = resolveTenantId(r, superAdmin, 'required', null);
  assert.ok(out instanceof Response, 'sem clínica, uma rota que precisa de uma não se pode servir');
  assert.equal((out as Response).status, 403);
});

test("'optional' é o único que entrega ausência de clínica, e aí significa «todas»", () => {
  const r = req({});
  assert.equal(resolveTenantId(r, superAdmin, 'optional', null), null);
});

test('um utilizador sem clínica que também não é super-admin nunca resolve nada', () => {
  // Não deve existir (users_role_tenant_consistency), mas se existir tem de ser
  // fail-closed: um `null` aqui significaria "todas as clínicas" para quem não é
  // ninguém.
  const orfao: SessionUser = { id: 'u3', name: 'Zé', role: 'receptionist', tenantId: null };
  const r = req({ url: `/api/x?tenantId=${TENANT_B}`, cookies: { acting_tenant: TENANT_A } });
  // Nem o ?tenantId= nem o cookie lhe valem: só o super-admin os pode usar. E como
  // 'resolved' e 'required' exigem uma clínica concreta, o que ele recebe é 403 — não
  // um null que as consultas leriam como "todas".
  assert.ok(resolveTenantId(r, orfao, 'resolved', null) instanceof Response);
  assert.ok(resolveTenantId(r, orfao, 'required', null) instanceof Response);
  assert.equal(resolveTenantId(r, orfao, 'optional', null), null);
});

// ─── 4. resolveTenantId delega mesmo em scopeTenant ─────────────────────────
// A versão anterior de lib/route.ts reimplementava a regra e esquecia-se do cookie
// acting_tenant, o que partia o super-admin dentro de uma clínica em qualquer rota
// migrada. Este teste existe para que as duas não possam voltar a divergir.

test('resolveTenantId concorda com scopeTenant em todos os casos acima', () => {
  const casos: Array<[SessionUser, ReturnType<typeof req>, string | null]> = [
    [utilizadorDeClinica, req({ url: `/api/x?tenantId=${TENANT_B}` }), null],
    [superAdmin, req({ cookies: { acting_tenant: TENANT_A } }), null],
    [superAdmin, req({}), TENANT_B],
    [superAdmin, req({}), null],
  ];
  for (const [user, request, pedido] of casos) {
    // O 403 que 'resolved' acrescenta quando não há clínica nenhuma é a camada de
    // cima; por baixo dela a resolução tem de ser exatamente a de scopeTenant.
    const out = resolveTenantId(request, user, 'resolved', pedido ? { tenantId: pedido } : null);
    const resolvido = out instanceof Response ? null : out;
    assert.equal(resolvido, scopeTenant(user, request, pedido), `caso ${user.role} / pedido=${pedido}`);
  }
});

// ─── 4. Registo das recusas ─────────────────────────────────────────────────
// withRoute devolvia 401/403 sem escrever uma linha em lado nenhum, e é por aqui
// que passam as recusas de todos os handlers. Estes testes correm sem base de
// dados, por isso cobrem o caminho do 401 — o único que, por decisão, não escreve
// no audit_log (ver o comentário de recordDenial). O 403 com sessão viva revalida
// contra a base e vive em test/integration/.

function capturingWarn(fn: (lines: string[]) => Promise<void>) {
  const real = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return fn(lines).finally(() => {
    console.warn = real;
  });
}

test('um 401 deixa rasto no log do processo sem tocar na base de dados', async () => {
  __resetRateLimitStore();
  await capturingWarn(async (lines) => {
    const route = withRoute({ permission: 'patients:create' }, handlerThatMustNotRun());
    const res = await route(req({ method: 'GET', url: '/api/patients' }), noParams);

    assert.equal(res.status, 401);
    const denied = lines.filter((l) => l.startsWith('[denied]'));
    assert.equal(denied.length, 1, 'a recusa devia ter sido registada exatamente uma vez');
    assert.match(denied[0], /GET \/api\/patients/, 'o método e o caminho identificam o que foi tentado');
    assert.match(denied[0], /\[401\]/);
  });
});

test('um cliente em ciclo não consegue encher o registo — as recusas são coalescidas', async () => {
  // Sem isto, cada pedido recusado escreve uma linha e o registo de segurança passa
  // a ser o alvo mais barato da aplicação.
  __resetRateLimitStore();
  await capturingWarn(async (lines) => {
    const route = withRoute({ permission: 'patients:create' }, handlerThatMustNotRun());
    for (let i = 0; i < 50; i += 1) {
      const res = await route(req({ method: 'GET', url: '/api/patients' }), noParams);
      assert.equal(res.status, 401, 'coalescer o registo não pode mudar a resposta');
    }

    const denied = lines.filter((l) => l.startsWith('[denied]'));
    assert.equal(denied.length, 5, '5 por minuto por identidade e caminho — as outras 45 são silenciadas');
  });
});

test('caminhos diferentes contam em separado — varrer endpoints continua visível', async () => {
  __resetRateLimitStore();
  await capturingWarn(async (lines) => {
    const route = withRoute({ permission: 'patients:create' }, handlerThatMustNotRun());
    for (const url of ['/api/patients', '/api/invoices', '/api/users']) {
      await route(req({ method: 'GET', url }), noParams);
    }

    const denied = lines.filter((l) => l.startsWith('[denied]'));
    assert.equal(denied.length, 3, 'o coalescer é por caminho, senão uma varredura ficava invisível');
  });
});
