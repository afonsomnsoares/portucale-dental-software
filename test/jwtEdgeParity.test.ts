import assert from 'node:assert/strict';
import test from 'node:test';

// ─── O que este ficheiro fixa ───────────────────────────────────────────────
// `lib/jwt-edge.ts` é uma reimplementação de `verifyToken` (lib/auth.ts) em
// WebCrypto, porque o runtime Edge onde o proxy.ts corre não tem `node:crypto`.
// Os dois ficheiros dizem-no por escrito e pedem que qualquer alteração seja
// espelhada — mas até aqui a única coisa a garantir que isso acontecia era alguém
// ler o comentário.
//
// O modo de falha que isso deixa em aberto não é uma exceção nem um teste
// vermelho: é o middleware e a rota passarem a discordar sobre que tokens são
// válidos. Na direção permissiva, o proxy deixa entrar no /dashboard quem a rota
// recusa; na direção restritiva, sessões legítimas deixam de navegar — a meio de
// uma rotação de segredos, por exemplo, que é exatamente quando ninguém quer
// descobrir isto.
//
// Por isso os testes abaixo nunca afirmam nada sobre um verificador sozinho.
// Afirmam sempre que os DOIS dão a mesma resposta ao mesmo token, e a asserção
// de igualdade é o teste. Uma alteração feita só de um lado fica vermelha aqui.

const SECRET = 'parity-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SECRET = 'parity-other-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// Importados com query única, como em test/auth.test.ts: os dois módulos leem os
// segredos de `process.env` a cada chamada, mas a convenção do ficheiro vizinho é
// esta e manter uma só evita que um teste futuro herde estado de outro.
async function loadBoth() {
  const node = await import(`../lib/auth.ts?x=${Math.random()}`);
  const edge = await import(`../lib/jwt-edge.ts?x=${Math.random()}`);
  return { signToken: node.signToken, verifyToken: node.verifyToken, verifyTokenEdge: edge.verifyTokenEdge };
}

// O coração do ficheiro. Corre os dois verificadores sobre o mesmo token e exige
// que concordem — primeiro em aceitar-ou-recusar, e depois, quando aceitam, nas
// claims que devolvem. Devolve o veredito para o teste poder afirmar qual é.
async function bothAgree(token: string) {
  const { verifyToken, verifyTokenEdge } = await loadBoth();
  const fromNode = verifyToken(token);
  const fromEdge = await verifyTokenEdge(token);

  assert.equal(
    fromNode === null,
    fromEdge === null,
    fromNode === null
      ? 'lib/auth.ts recusou o token e lib/jwt-edge.ts aceitou-o — o proxy deixa entrar quem as rotas barram'
      : 'lib/auth.ts aceitou o token e lib/jwt-edge.ts recusou-o — sessões válidas param no proxy',
    );

  if (fromNode && fromEdge) {
    // Só os campos que o Edge declara em EdgeSessionUser: `iat`/`exp`/`jti` existem
    // no payload dos dois, mas é sobre estes que o proxy.ts decide.
    for (const campo of ['id', 'name', 'role', 'clinic', 'tenantId'] as const) {
      assert.deepEqual(fromEdge[campo], fromNode[campo], `os dois verificadores discordam no campo "${campo}"`);
    }
  }
  return fromNode !== null;
}

test('parity: um token acabado de assinar é aceite pelos dois, com as mesmas claims', async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const token = signToken({ id: 'u1', name: 'Ana', role: 'dentist', clinic: 'Porto', tenantId: 't1' });
  assert.equal(await bothAgree(token), true);
});

test('parity: acentos no payload sobrevivem aos dois descodificadores', async () => {
  // Não é um caso de laboratório: a aplicação é inteiramente em pt-PT e o `name` e
  // o `clinic` vêm de `users`/`tenants`. Os dois lados descodificam base64url por
  // caminhos diferentes — Buffer no Node, atob + TextDecoder no Edge — e é aí que
  // um byte de UTF-8 mal tratado apareceria como um nome trocado no menu.
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const token = signToken({
    id: 'u2',
    name: 'José Gonçalves Antunes',
    role: 'admin',
    clinic: 'Clínica Dentária São João',
    tenantId: 't2',
  });
  assert.equal(await bothAgree(token), true);

  const { verifyTokenEdge } = await loadBoth();
  const p = await verifyTokenEdge(token);
  assert.equal(p?.name, 'José Gonçalves Antunes');
  assert.equal(p?.clinic, 'Clínica Dentária São João');
});

test('parity: um token expirado é recusado pelos dois', async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  // O mínimo que signToken aceita fora de produção é 1s (ver o minTtl lá).
  process.env.JWT_TTL_SECONDS = '1';
  const { signToken } = await loadBoth();
  const token = signToken({ id: 'u3', name: 'Ana', role: 'admin' });
  assert.equal(await bothAgree(token), true);

  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await bothAgree(token), false);
});

test('parity: a rotação de segredos vale nos dois, e na mesma ordem', async () => {
  // O caso que mais importa dos quatro: durante uma rotação, um token assinado com o
  // segredo antigo tem de continuar a passar nos dois sítios. Se só um deles
  // percorresse a lista, a rotação partia metade da aplicação.
  process.env.JWT_SECRET = OTHER_SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const antigo = signToken({ id: 'u4', name: 'Ana', role: 'receptionist', tenantId: 't1' });

  // Segredo novo à frente, antigo ainda aceite — a forma da rotação.
  process.env.JWT_SECRET = '';
  process.env.JWT_SECRETS = `${SECRET},${OTHER_SECRET}`;
  assert.equal(await bothAgree(antigo), true);

  // E quando o antigo sai da lista, os dois têm de o recusar ao mesmo tempo.
  process.env.JWT_SECRETS = SECRET;
  assert.equal(await bothAgree(antigo), false);
});

test('parity: assinatura adulterada é recusada pelos dois', async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const [hdr, bdy, sig] = signToken({ id: 'u5', name: 'Ana', role: 'admin' }).split('.');

  // Um bit trocado na assinatura, mantendo o comprimento — as comparações dos dois
  // lados saem cedo em comprimentos diferentes, e isso esconderia o teste.
  const trocado = `${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`;
  assert.equal(await bothAgree(`${hdr}.${bdy}.${trocado}`), false);
});

test('parity: payload adulterado (escalada de papel) é recusado pelos dois', async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const token = signToken({ id: 'u6', name: 'Ana', role: 'receptionist', tenantId: 't1' });
  const [hdr, bdy, sig] = token.split('.');

  const payload = JSON.parse(Buffer.from(bdy, 'base64url').toString());
  payload.role = 'super_admin';
  payload.tenantId = null;
  const forjado = Buffer.from(JSON.stringify(payload)).toString('base64url');

  assert.equal(await bothAgree(`${hdr}.${forjado}.${sig}`), false);
});

test('parity: um token assinado com um segredo desconhecido é recusado pelos dois', async () => {
  process.env.JWT_SECRET = OTHER_SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const token = signToken({ id: 'u7', name: 'Ana', role: 'admin' });

  process.env.JWT_SECRET = SECRET;
  assert.equal(await bothAgree(token), false);
});

test('parity: `nbf` no futuro é recusado pelos dois', async () => {
  // Nada nesta aplicação emite `nbf` hoje, mas os dois verificadores dizem que o
  // honram. Duas verificações que ninguém exercita são duas verificações livres de
  // divergir — e esta é barata de manter alinhada.
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  const { signToken } = await loadBoth();
  const [hdr, bdy] = signToken({ id: 'u8', name: 'Ana', role: 'admin' }).split('.');

  const payload = JSON.parse(Buffer.from(bdy, 'base64url').toString());
  payload.nbf = Math.floor(Date.now() / 1000) + 3600;
  const futuro = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Reassinado, para o que está a ser testado ser o `nbf` e não a assinatura.
  const crypto = await import('node:crypto');
  const sig = crypto.createHmac('sha256', SECRET).update(`${hdr}.${futuro}`).digest('base64url');

  assert.equal(await bothAgree(`${hdr}.${futuro}.${sig}`), false);
});

test('parity: tokens malformados são recusados pelos dois, sem rebentar', async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  for (const mau of ['', 'nada', 'a.b', 'a.b.c', '...', 'a.b.c.d', '.eyJhIjoxfQ.x']) {
    assert.equal(await bothAgree(mau), false, `discordaram sobre o token malformado ${JSON.stringify(mau)}`);
  }
});

test('parity: sem segredo configurado, nenhum dos dois aceita fosse o que fosse', async () => {
  // Divergem na forma — `verifyToken` deixa sair o throw de requireJwtSecrets, que o
  // seu próprio try/catch converte em null, e `verifyTokenEdge` devolve null
  // diretamente — mas têm de convergir no resultado: sem segredo, ninguém entra.
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_SECRETS = '';
  process.env.JWT_TTL_SECONDS = '3600';
  const { signToken } = await loadBoth();
  const token = signToken({ id: 'u9', name: 'Ana', role: 'admin' });

  process.env.JWT_SECRET = '';
  process.env.JWT_SECRETS = '';
  assert.equal(await bothAgree(token), false);
});
