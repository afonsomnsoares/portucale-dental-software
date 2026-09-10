import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTENSION_FOR_TYPE,
  MAGIC_BYTES_TO_READ,
  UPLOAD_ALLOWED_TYPES,
  canonicalUploadType,
  checkUploadType,
  extensionForUploadType,
  magicBytesMatch,
} from '../lib/uploadsCalc.ts';

test('aceita os quatro tipos permitidos e dá-lhes a extensão certa', () => {
  assert.equal(extensionForUploadType('image/png'), 'png');
  assert.equal(extensionForUploadType('image/jpeg'), 'jpg');
  assert.equal(extensionForUploadType('image/webp'), 'webp');
  assert.equal(extensionForUploadType('application/pdf'), 'pdf');
});

// A regressão que interessa: era este o caso que lib/uploads.ts deixava passar sem
// olhar (`if (type && ...)`), e com ele um ficheiro chamado `x.html` era gravado como
// `<uuid>.html` em public/uploads/ e servido da nossa própria origem.
test('recusa um ficheiro sem content type declarado', () => {
  assert.equal(extensionForUploadType(''), null);
  assert.equal(extensionForUploadType(null), null);
  assert.equal(extensionForUploadType(undefined), null);
});

test('recusa tipos executáveis ou renderizáveis pelo browser', () => {
  for (const type of ['text/html', 'image/svg+xml', 'application/javascript', 'text/xml']) {
    assert.equal(extensionForUploadType(type), null, `${type} não devia ser aceite`);
  }
});

test('normaliza parâmetros e maiúsculas sem alargar a lista branca', () => {
  assert.equal(extensionForUploadType('IMAGE/PNG'), 'png');
  assert.equal(extensionForUploadType('image/png; charset=binary'), 'png');
  assert.equal(extensionForUploadType('  image/jpeg  '), 'jpg');
  // Contrabandear um tipo proibido atrás de um permitido não funciona.
  assert.equal(extensionForUploadType('text/html; x=image/png'), null);
});

test('a extensão nunca sai do conjunto conhecido', () => {
  const allowed = new Set(Object.values(EXTENSION_FOR_TYPE));
  for (const type of UPLOAD_ALLOWED_TYPES) {
    const ext = extensionForUploadType(type);
    assert.ok(ext && allowed.has(ext), `${type} devia mapear para uma extensão conhecida`);
  }
});

// A lista branca e a tabela de extensões são a mesma coisa por construção — se alguém
// acrescentar um tipo sem lhe dar extensão, é aqui que dá erro em vez de em produção.
test('lista branca e tabela de extensões não podem divergir', () => {
  assert.deepEqual([...UPLOAD_ALLOWED_TYPES].sort(), Object.keys(EXTENSION_FOR_TYPE).sort());
});

// Regressão: a pertença à lista branca não pode ser testada com `in` nem com um acesso
// direto ao objeto — as propriedades do protótipo passariam por tipos válidos e a
// "extensão" devolvida seria uma função.
test('propriedades do protótipo não são content types válidos', () => {
  for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(canonicalUploadType(type), null, `${type} não devia ser aceite`);
    assert.equal(extensionForUploadType(type), null, `${type} não devia dar extensão`);
  }
});

test('canonicalUploadType devolve a forma normalizada, não a string crua', () => {
  assert.equal(canonicalUploadType('IMAGE/PNG; charset=binary'), 'image/png');
  assert.equal(canonicalUploadType('application/pdf'), 'application/pdf');
  assert.equal(canonicalUploadType('text/html'), null);
});

// ═══ Verificação de assinatura (magic bytes) ════════════════════════════════
// A lista branca acima valida o tipo DECLARADO — declarado por quem envia, ou seja,
// escolhido pelo atacante. Estes testes cobrem a diferença entre isso e a verdade.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');

test('reconhece os quatro tipos aceites pela assinatura', () => {
  assert.ok(magicBytesMatch('image/png', PNG));
  assert.ok(magicBytesMatch('image/jpeg', JPEG));
  assert.ok(magicBytesMatch('application/pdf', PDF));
  assert.ok(magicBytesMatch('image/webp', WEBP));
});

// O caso central: o tipo declarado é o único valor que o atacante controla.
test('HTML disfarçado de PNG é apanhado', () => {
  const r = checkUploadType('image/png', HTML);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : '', /não corresponde/);
});

test('um PDF declarado como imagem é apanhado', () => {
  assert.equal(checkUploadType('image/jpeg', PDF).ok, false);
});

test('um PNG declarado como PDF é apanhado', () => {
  assert.equal(checkUploadType('application/pdf', PNG).ok, false);
});

// RIFF sozinho não distingue WebP de WAV nem de AVI — todos começam por RIFF.
test('um WAV não passa por WebP só por começar com RIFF', () => {
  assert.equal(magicBytesMatch('image/webp', WAV), false);
  assert.ok(magicBytesMatch('image/webp', WEBP));
});

test('as três variantes comuns de JPEG são aceites', () => {
  for (const marker of [0xe0, 0xe1, 0xdb, 0xee]) {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, marker, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(magicBytesMatch('image/jpeg', jpeg), `variante 0x${marker.toString(16)} devia passar`);
  }
});

test('um tipo fora da lista branca nunca passa, mesmo com assinatura conhecida', () => {
  assert.equal(magicBytesMatch('image/svg+xml', PNG), false);
  assert.equal(checkUploadType('text/html', HTML).ok, false);
});

test('um ficheiro truncado não passa por falta de bytes', () => {
  assert.equal(magicBytesMatch('image/png', PNG.subarray(0, 3)), false);
  assert.equal(magicBytesMatch('image/webp', WEBP.subarray(0, 6)), false);
});

test('um ficheiro vazio é recusado', () => {
  assert.equal(checkUploadType('image/png', new Uint8Array(0)).ok, false);
});

test('checkUploadType devolve o tipo canónico e a extensão de uma vez', () => {
  const r = checkUploadType('IMAGE/PNG; charset=binary', PNG);
  assert.equal(r.ok, true);
  assert.equal(r.ok === true ? r.type : '', 'image/png');
  assert.equal(r.ok === true ? r.extension : '', 'png');
});

// Não dizer o que o ficheiro É na verdade evita dar um oráculo a quem tenta.
test('a mensagem de erro não revela o tipo real do ficheiro', () => {
  const r = checkUploadType('image/png', PDF);
  const erro = r.ok === false ? r.error : '';
  assert.doesNotMatch(erro, /pdf/i);
});

test('MAGIC_BYTES_TO_READ chega para todas as assinaturas em uso', () => {
  assert.ok(MAGIC_BYTES_TO_READ >= 12, 'o WebP precisa de 12 bytes');
  assert.ok(magicBytesMatch('image/webp', WEBP.subarray(0, MAGIC_BYTES_TO_READ)));
});
