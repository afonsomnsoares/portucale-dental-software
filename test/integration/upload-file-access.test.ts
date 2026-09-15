// Testes de acesso a ficheiros de doentes. Correr com:
//   node --import tsx --env-file=.env.test --test test/integration/
//
// Os ficheiros — raios-X, documentos de identificação, cartões de seguro,
// consentimentos assinados — eram gravados em `public/uploads`, que o Next serve
// estaticamente e sem passar por rota nenhuma. O `uploads.url` guardava esse caminho.
// O controlo de acesso era, portanto, um só: o endereço ser difícil de adivinhar.
//
// Quem tivesse o endereço via o ficheiro sem sessão, a partir de outra clínica, depois
// de ter saído da empresa, e sem fim — o `expires_at` só era aplicado pelo job noturno
// que apaga o ficheiro do disco.
//
// Agora o único caminho é app/api/uploads/[id]/file. Estes testes fixam as três
// perguntas que ele faz: há sessão, a linha é desta clínica, e ainda não expirou.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { GET as getFile } from '../../app/api/uploads/[id]/file/route.ts';
import { query } from '../../lib/db.ts';
import { UPLOADS_DIR } from '../../lib/uploads.ts';
import { authedRequest, type TestUser } from '../helpers/authedRequest.ts';
import {
  closeTestDb,
  ensureSeeded,
  getSeededPatientId,
  getSeededUser,
  getTenantAId,
  getTenantBId,
} from '../helpers/testDb.ts';

const CONTEUDO = 'conteudo-de-teste-nao-e-um-raio-x';

let dentistaA: TestUser;
let adminB: TestUser;
let tenantAId: string;
let tenantBId: string;

/** Cria uma linha de upload com um ficheiro a sério por baixo. */
async function criarUpload(tenantId: string, patientId: string, opts: { expiresAt?: string | null } = {}) {
  const nome = `${crypto.randomUUID()}.pdf`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, nome), CONTEUDO);

  const [row] = await query(
    `INSERT INTO uploads (tenant_id, patient_id, storage, storage_key, url, content_type, size, expires_at, category)
     VALUES ($1,$2,'local',$3,'',$4,$5,$6::timestamptz,'other')
     RETURNING id`,
    [tenantId, patientId, nome, 'application/pdf', CONTEUDO.length, opts.expiresAt ?? null],
  );
  await query(`UPDATE uploads SET url=$1 WHERE id=$2`, [`/api/uploads/${row.id}/file`, row.id]);
  return String(row.id);
}

function pedir(as: TestUser | null, id: string) {
  const req = as
    ? authedRequest(as, { url: `http://localhost/api/uploads/${id}/file` })
    : (new Request(`http://localhost/api/uploads/${id}/file`) as never);
  return getFile(req, { params: Promise.resolve({ id }) });
}

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  tenantBId = await getTenantBId();
  dentistaA = await getSeededUser('medico@portucale.dental');
  adminB = await getSeededUser('admin.b@tenantb.test');
});

after(async () => {
  await query(`DELETE FROM uploads WHERE category='other' AND url LIKE '/api/uploads/%'`);
  await closeTestDb();
});

test('caminho feliz: quem é da clínica lê o ficheiro', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const id = await criarUpload(tenantAId, patientId);

  const res = await pedir(dentistaA, id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), CONTEUDO);
});

test('o ficheiro sai como descarga e sem cache partilhada', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const id = await criarUpload(tenantAId, patientId);

  const res = await pedir(dentistaA, id);
  assert.match(res.headers.get('content-disposition') || '', /^attachment/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control') || '', /private/);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('sem sessão não se lê nada — era isto que o URL direto permitia', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const id = await criarUpload(tenantAId, patientId);

  const res = await pedir(null, id);
  assert.equal(res.status, 401);
});

test('outra clínica recebe 404, e não 403', async () => {
  // 404 de propósito: para quem não é da clínica, saber que a linha existe já é
  // informação — diz que aquele doente tem um ficheiro daquele tipo.
  const patientId = await getSeededPatientId(tenantAId);
  const id = await criarUpload(tenantAId, patientId);

  const res = await pedir(adminB, id);
  assert.equal(res.status, 404);
});

test('um ficheiro expirado deixa de sair no mesmo instante, sem esperar pelo job da noite', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const ontem = new Date(Date.now() - 86400000).toISOString();
  const id = await criarUpload(tenantAId, patientId, { expiresAt: ontem });

  const res = await pedir(dentistaA, id);
  assert.equal(res.status, 404, 'o ficheiro ainda está em disco, mas a retenção já o deu por expirado');
});

test('uma validade no futuro não impede a leitura', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const amanha = new Date(Date.now() + 86400000).toISOString();
  const id = await criarUpload(tenantAId, patientId, { expiresAt: amanha });

  const res = await pedir(dentistaA, id);
  assert.equal(res.status, 200);
});

test('um id que não existe devolve 404 e não estoira', async () => {
  const res = await pedir(dentistaA, crypto.randomUUID());
  assert.equal(res.status, 404);
});

test('a linha sem ficheiro por baixo devolve 404 em vez de 500', async () => {
  const patientId = await getSeededPatientId(tenantAId);
  const [row] = await query(
    `INSERT INTO uploads (tenant_id, patient_id, storage, storage_key, url, content_type, size, category)
     VALUES ($1,$2,'local','nao-existe-em-disco.pdf','','application/pdf',10,'other')
     RETURNING id`,
    [tenantAId, patientId],
  );
  await query(`UPDATE uploads SET url=$1 WHERE id=$2`, [`/api/uploads/${row.id}/file`, row.id]);

  const res = await pedir(dentistaA, String(row.id));
  assert.equal(res.status, 404);
});

test('o url guardado aponta para a rota, e nunca para o disco ou para o bucket', async () => {
  const patientId = await getSeededPatientId(tenantBId);
  const id = await criarUpload(tenantBId, patientId);

  const [row] = (await query(`SELECT url FROM uploads WHERE id=$1`, [id])) as { url: string }[];
  assert.equal(row.url, `/api/uploads/${id}/file`);
  assert.ok(!row.url.startsWith('/uploads/'), 'voltou a apontar para o diretório servido estaticamente');
  assert.ok(!row.url.startsWith('http'), 'voltou a apontar para o bucket público');
});
