import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { getObjectR2 } from '@/lib/r2';
import { withRoute } from '@/lib/route';
import { LEGACY_UPLOADS_DIR, UPLOADS_DIR } from '@/lib/uploads';

// ─── O único caminho por onde um ficheiro de doente é servido ────────────────
//
// O que estava antes
// ------------------
// `lib/uploads.ts` gravava em `public/uploads/` — o diretório estático do Next — e
// guardava em `uploads.url` o caminho `/uploads/<uuid>.<ext>`. Isso quer dizer que o
// controlo de acesso a raios-X, documentos de identificação, cartões de seguro e
// consentimentos assinados era uma coisa só: o endereço ser difícil de adivinhar.
//
// Quem tivesse o URL via o ficheiro — sem sessão, de outra clínica, depois de sair da
// empresa, e para sempre. O `expires_at` era aplicado só pelo job noturno que apaga o
// ficheiro do disco; entre o momento em que a retenção o dava por expirado e a
// passagem seguinte do job, continuava a ser servido. O caminho do R2 tinha
// exatamente a mesma propriedade, com o bucket público por trás.
//
// O que é agora
// -------------
// O ficheiro só sai daqui, e só depois de três perguntas: há sessão, a linha é desta
// clínica, e ainda não expirou. O `withRoute` trata da primeira, o `tenantId` na
// cláusula trata da segunda (e o RLS da migração 011 fica por baixo como rede), e o
// `expires_at` é conferido no momento do pedido — não daqui a uma noite.
//
// `storage_key` é a fonte da verdade sobre onde o ficheiro está. O `url` guardado na
// linha passou a ser este endereço, e nunca mais um caminho para o disco ou para o
// bucket: ver a migração 059, que reescreveu as linhas antigas.
export const GET = withRoute<{ id: string }>(
  { permission: 'uploads:read', tenant: 'optional' },
  async ({ params, tenantId }) => {
    const { id } = params;

    const row = await queryOne(
      `SELECT id, storage, storage_key, content_type, size, expires_at
         FROM uploads
        WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`,
      [id, tenantId],
    );

    // 404 e não 403 de propósito: para quem não é da clínica, a existência da linha
    // é ela própria informação — diz que aquele doente tem um ficheiro daquele tipo.
    if (!row) return notFound('Ficheiro não encontrado');

    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      // A retenção já o deu por expirado. O ficheiro pode ainda estar em disco até
      // à próxima passagem do job — deixar de o servir não espera por essa passagem.
      return notFound('Ficheiro não encontrado');
    }

    const contentType = row.content_type || 'application/octet-stream';

    // ─── Cabeçalhos que valem para os dois armazenamentos ────────────────────
    // `attachment` força a descarga em vez de o navegador renderizar o ficheiro na
    // nossa origem — com `nosniff` por cima, mesmo um tipo declarado errado não
    // consegue ser interpretado como HTML ou script aqui dentro.
    // `private, no-store`: um ficheiro clínico não fica em cache partilhada, e o
    // Caddy está pelo meio.
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${String(row.id)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store, max-age=0',
    };

    if (row.storage === 'r2') {
      const obj = await getObjectR2({ key: String(row.storage_key) });
      if (!obj.ok || !obj.body) return notFound('Ficheiro não encontrado');
      if (obj.contentLength) headers['Content-Length'] = obj.contentLength;
      return new Response(obj.body, { headers });
    }

    // ─── Local ───────────────────────────────────────────────────────────────
    // `path.basename` sobre o storage_key antes de o juntar ao diretório: a coluna é
    // escrita por nós e só contém um UUID com extensão, mas juntar um valor de base
    // de dados a um caminho sem o reduzir ao nome é como se escrevem travessias de
    // diretório. O mesmo raciocínio de deleteStoredFiles em lib/uploads.ts.
    const nome = path.basename(String(row.storage_key));

    // O diretório privado primeiro; o antigo a seguir, para as instalações que já
    // tinham ficheiros em public/uploads antes desta mudança (ver LEGACY_UPLOADS_DIR
    // em lib/uploads.ts).
    let file: string | null = null;
    for (const dir of [UPLOADS_DIR, LEGACY_UPLOADS_DIR]) {
      const candidato = path.join(dir, nome);
      try {
        const info = await stat(candidato);
        if (info.isFile()) {
          headers['Content-Length'] = String(info.size);
          file = candidato;
          break;
        }
      } catch {
        // Passa ao seguinte.
      }
    }

    // A linha existe e o ficheiro não — o job de retenção já o apagou, ou o volume
    // não está montado. Nos dois casos, para quem pede é um ficheiro que não há.
    if (!file) return notFound('Ficheiro não encontrado');

    // ─── O aviso do Turbopack nesta linha é conhecido ────────────────────────
    // «Dynamic filesystem access causes tracing of the whole project». É inerente a
    // servir um ficheiro cujo caminho só se conhece em tempo de execução, que é
    // exatamente o que esta rota faz — não há forma de o evitar sem deixar de ler do
    // disco. E não tem consequência aqui: o aviso é sobre o rastreio de ficheiros
    // para o `output: 'standalone'`, que este projeto não usa (ver next.config.mjs);
    // o Dockerfile copia `node_modules` e `.next` à mão.
    //
    // `readFile` e não `createReadStream` porque o ficheiro cabe em memória por
    // construção — o UPLOAD_MAX_BYTES de lib/uploadsCalc.ts são 6 MB, e nada entra
    // aqui sem ter passado por lá. Se esse teto subir muito, volta a ser um stream.
    return new Response(await readFile(file), { headers });
  },
);
