import assert from 'node:assert/strict';
import test from 'node:test';
import { getR2Config } from '../lib/r2.ts';

test('r2 config is null when env vars are missing', () => {
  const cfg = getR2Config();
  assert.equal(cfg, null);
});

// ─── O caminho direto para o R2 foi removido ────────────────────────────────
// Existia um `presignPutObjectR2` e uma rota GET /api/uploads/presign que emitiam um URL
// assinado para o browser fazer PUT direto ao bucket. Saíram, e a razão vale a pena
// ficar escrita aqui, que é onde alguém vai procurar antes de os reintroduzir:
//
//   1. O servidor nunca via os bytes, por isso o caminho direto NÃO PODIA correr o
//      checkUploadType de lib/uploadsCalc.ts — a confrontação da assinatura do ficheiro
//      com o tipo declarado. É a defesa que existe porque o portal do doente deixa
//      alguém sem sessão nenhuma escrever um ficheiro no armazenamento da clínica.
//   2. Não havia rota nenhuma para registar o ficheiro depois do PUT: ele ficava no
//      bucket e invisível para a aplicação.
//   3. A justificação («ficheiros grandes demais para passar pelo servidor») não se
//      aplica com UPLOAD_MAX_BYTES em 6 MB.
//
// Se um dia fizer falta, a forma correta é: presign → PUT → uma rota de confirmação que
// leia os primeiros bytes do objeto por um GET com Range, corra o checkUploadType, e só
// então registe a linha — apagando o objeto se falhar. Sem esse passo, é uma porta que
// contorna a única verificação que o produto tem sobre o conteúdo de um ficheiro.
