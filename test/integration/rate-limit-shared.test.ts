// O contador partilhado existe para um cenário que nenhum teste unitário
// consegue reproduzir: duas instâncias da aplicação a servir o mesmo login.
// Em memória, cada uma tinha o seu balde e o travão não travava.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { query } from '../../lib/db.ts';
import { rateLimitShared, sweepRateLimitCounters } from '../../lib/rateLimitShared.ts';
import { closeTestDb, ensureSeeded } from '../helpers/testDb.ts';

before(ensureSeeded);
after(closeTestDb);

const KEY = () => `test:${Math.random().toString(36).slice(2)}`;

test('conta através de chamadas independentes — o que uma instância gasta, a outra vê', async () => {
  const key = KEY();
  const limit = { limit: 3, windowMs: 60_000 };

  // Cada await é uma chamada separada, tal como pedidos servidos por instâncias
  // diferentes: nada é partilhado em memória entre elas.
  const r1 = await rateLimitShared(key, limit);
  const r3 = await rateLimitShared(key, limit);
  const r4 = await rateLimitShared(key, limit);

  assert.equal(r1.ok, true, '1ª tentativa passa');
  assert.equal(r3.ok, true, '3ª tentativa ainda está dentro do limite');
  assert.equal(r4.ok, false, '4ª tentativa é bloqueada');
  assert.equal(r1.remaining, 2);
  assert.equal(r4.remaining, 0);
});

test('incremento é atómico sob concorrência — nenhuma tentativa se perde', async () => {
  const key = KEY();
  const limit = { limit: 100, windowMs: 60_000 };

  // 30 pedidos verdadeiramente em paralelo. Um SELECT-depois-UPDATE perderia
  // contagens aqui; o INSERT ... ON CONFLICT não.
  await Promise.all(Array.from({ length: 30 }, () => rateLimitShared(key, limit)));

  const [row] = await query('SELECT count FROM rate_limit_counters WHERE key=$1', [key]);
  assert.equal(Number(row.count), 30, 'as 30 tentativas concorrentes foram todas contadas');
});

test('a janela reabre quando expira', async () => {
  const key = KEY();
  const limit = { limit: 1, windowMs: 60_000 };

  assert.equal((await rateLimitShared(key, limit)).ok, true);
  assert.equal((await rateLimitShared(key, limit)).ok, false, 'bloqueado dentro da janela');

  // Envelhecer a janela em vez de esperar por ela.
  await query(`UPDATE rate_limit_counters SET window_start = NOW() - INTERVAL '2 minutes' WHERE key=$1`, [key]);

  const after = await rateLimitShared(key, limit);
  assert.equal(after.ok, true, 'janela expirada volta a permitir');
  assert.equal(after.remaining, 0, 'e recomeça a contagem em 1');
});

test('retryAfterMs aponta para o fim da janela, não para além dela', async () => {
  const key = KEY();
  const r = await rateLimitShared(key, { limit: 1, windowMs: 60_000 });
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 60_000, `esperado 0<x<=60000, recebido ${r.retryAfterMs}`);
});

test('a varredura remove janelas velhas e poupa as vivas', async () => {
  const velha = KEY();
  const nova = KEY();
  await rateLimitShared(velha, { limit: 5, windowMs: 60_000 });
  await rateLimitShared(nova, { limit: 5, windowMs: 60_000 });
  await query(`UPDATE rate_limit_counters SET window_start = NOW() - INTERVAL '3 days' WHERE key=$1`, [velha]);

  await sweepRateLimitCounters();

  const restantes = await query('SELECT key FROM rate_limit_counters WHERE key = ANY($1::text[])', [[velha, nova]]);
  const chaves = restantes.map((r) => r.key);
  assert.ok(!chaves.includes(velha), 'a janela expirada foi removida');
  assert.ok(chaves.includes(nova), 'a janela ativa sobreviveu');
});
