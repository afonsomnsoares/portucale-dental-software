// O login carrega um DUMMY_PASSWORD_HASH e 14 linhas de comentário para fechar a
// fuga de "esta conta existe" pelo canal de timing. O canal do código de estado
// ficava aberto: sem o campo `password` no corpo, o bcryptjs lançava numa conta
// existente (500) e não lançava numa inexistente (401) — o mesmo oráculo, muito
// mais fácil de explorar. Estes testes fixam o comportamento corrigido.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { NextRequest } from 'next/server';
import { POST as login } from '../../app/api/auth/login/route.ts';
import { closeTestDb, ensureSeeded } from '../helpers/testDb.ts';

before(ensureSeeded);
after(closeTestDb);

// O login é anónimo mas continua a ser uma mutação, por isso requireSameOrigin()
// exige o par cookie/cabeçalho de CSRF — que o browser tem via /api/auth/csrf.
function loginRequest(rawBody: string): NextRequest {
  const csrf = crypto.randomUUID();
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      cookie: `dent_csrf=${csrf}`,
      'x-csrf-token': csrf,
    },
    body: rawBody,
  }) as unknown as NextRequest;
}

test('sem password: conta existente e inexistente respondem exatamente igual', async () => {
  const existente = await login(loginRequest(JSON.stringify({ email: 'admin@portucale.dental' })), { params: Promise.resolve({}) });
  const inexistente = await login(loginRequest(JSON.stringify({ email: 'nao-existe-de-todo@exemplo.pt' })), { params: Promise.resolve({}) });

  assert.equal(existente.status, 401, 'conta existente sem password -> 401 (antes da correção: 500)');
  assert.equal(inexistente.status, 401, 'conta inexistente sem password -> 401');
  assert.deepEqual(await existente.json(), await inexistente.json(), 'corpos idênticos — nada distingue as duas');
});

test('corpo malformado devolve 400, não 500', async () => {
  const res = await login(loginRequest('{ isto não é json'), { params: Promise.resolve({}) });
  assert.equal(res.status, 400);
});

test('password errada continua a devolver 401', async () => {
  const res = await login(loginRequest(JSON.stringify({ email: 'admin@portucale.dental', password: 'errada' })), { params: Promise.resolve({}) });
  assert.equal(res.status, 401);
});
