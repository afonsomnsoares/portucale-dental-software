import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueryCache, DEFAULT_STALE_MS } from '../lib/queryCache.ts';

// A cache de leituras do cliente. Testada aqui, e não através de um componente,
// porque é isso que ela é: regras sobre frescura, partilha e invalidação. O
// hooks/useQuery.ts fica só com o que precisa mesmo de React.

test('uma chave que nunca foi escrita falha', () => {
  const c = createQueryCache();
  assert.equal(c.read('/patients', DEFAULT_STALE_MS).status, 'miss');
});

test('dentro da janela, os dados estão frescos', () => {
  const c = createQueryCache();
  c.write('/patients', [{ id: 'a' }], 1000);
  const r = c.read('/patients', 30_000, 1000 + 29_999);
  assert.equal(r.status, 'fresh');
  assert.deepEqual(r.data, [{ id: 'a' }]);
});

test('passada a janela ficam velhos — mas continuam a ser devolvidos', () => {
  const c = createQueryCache();
  c.write('/patients', [{ id: 'a' }], 1000);
  const r = c.read('/patients', 30_000, 1000 + 30_001);
  assert.equal(r.status, 'stale');
  // O ponto do 'stale': mostrar o valor de há um minuto enquanto o novo vem a
  // caminho é melhor do que piscar um spinner sobre uma tabela que se estava a ler.
  assert.deepEqual(r.data, [{ id: 'a' }]);
});

test('o limite da janela conta como fresco, não como velho', () => {
  const c = createQueryCache();
  c.write('/x', 1, 0);
  assert.equal(c.read('/x', 1000, 1000).status, 'fresh');
  assert.equal(c.read('/x', 1000, 1001).status, 'stale');
});

test('dois pedidos simultâneos à mesma chave partilham um só', async () => {
  const c = createQueryCache();
  let chamadas = 0;
  const run = () => {
    chamadas++;
    return new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 5));
  };

  const [a, b] = await Promise.all([c.dedupe('/patients', run), c.dedupe('/patients', run)]);

  assert.equal(chamadas, 1, 'o segundo chamador devia ter recebido a promessa do primeiro');
  assert.equal(a, 'ok');
  assert.equal(b, 'ok');
});

test('chaves diferentes não se partilham', async () => {
  const c = createQueryCache();
  let chamadas = 0;
  const run = async () => {
    chamadas++;
    return 'ok';
  };
  await Promise.all([c.dedupe('/patients', run), c.dedupe('/appointments', run)]);
  assert.equal(chamadas, 2);
});

test('uma chave que falhou pode ser tentada outra vez', async () => {
  const c = createQueryCache();
  let chamadas = 0;
  const falha = async () => {
    chamadas++;
    throw new Error('500');
  };

  await assert.rejects(() => c.dedupe('/patients', falha));
  // Se a promessa rejeitada ficasse presa no mapa de pedidos em voo, esta
  // segunda tentativa recebia o mesmo erro sem chegar a pedir nada.
  await assert.rejects(() => c.dedupe('/patients', falha));
  assert.equal(chamadas, 2);
});

test('depois de resolver, a chave deixa de estar em voo', async () => {
  const c = createQueryCache();
  let chamadas = 0;
  const run = async () => {
    chamadas++;
    return 'ok';
  };
  await c.dedupe('/x', run);
  await c.dedupe('/x', run);
  assert.equal(chamadas, 2, 'o dedupe é para pedidos SIMULTÂNEOS, não é a cache');
});

test('invalidar apanha as variantes da mesma coleção', () => {
  const c = createQueryCache();
  c.write('/patients', []);
  c.write('/patients?q=ana', []);
  c.write('/patients/123', {});
  c.write('/appointments', []);

  const afetadas = c.invalidate('/patients').sort();

  assert.deepEqual(afetadas, ['/patients', '/patients/123', '/patients?q=ana']);
  assert.equal(c.read('/patients?q=ana', DEFAULT_STALE_MS).status, 'miss');
  // E não leva à frente o que não é dela.
  assert.equal(c.read('/appointments', DEFAULT_STALE_MS).status, 'fresh');
});

test('invalidar avisa quem estiver a ouvir a chave ou o seu prefixo', () => {
  const c = createQueryCache();
  const avisos: string[] = [];
  c.subscribe('/patients', () => avisos.push('lista'));
  c.subscribe('/patients?q=ana', () => avisos.push('pesquisa'));
  c.subscribe('/appointments', () => avisos.push('agenda'));

  c.invalidate('/patients');

  assert.deepEqual(avisos.sort(), ['lista', 'pesquisa']);
});

test('cancelar a subscrição deixa de avisar', () => {
  const c = createQueryCache();
  let avisos = 0;
  const cancelar = c.subscribe('/patients', () => avisos++);
  c.invalidate('/patients');
  cancelar();
  c.invalidate('/patients');
  assert.equal(avisos, 1);
});

test('clear() esquece tudo — é o que o logout precisa', () => {
  const c = createQueryCache();
  c.write('/patients', []);
  c.write('/appointments', []);
  assert.equal(c.size(), 2);
  c.clear();
  assert.equal(c.size(), 0);
  assert.equal(c.read('/patients', DEFAULT_STALE_MS).status, 'miss');
});

test('escrever outra vez a mesma chave repõe a frescura', () => {
  const c = createQueryCache();
  c.write('/x', 'antigo', 0);
  assert.equal(c.read('/x', 1000, 5000).status, 'stale');
  c.write('/x', 'novo', 5000);
  const r = c.read('/x', 1000, 5000);
  assert.equal(r.status, 'fresh');
  assert.equal(r.data, 'novo');
});
