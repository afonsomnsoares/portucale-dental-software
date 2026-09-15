import crypto from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from './db';
import { completeTask } from './patientTasks';
import { deleteObjectR2, getR2Config, putObjectR2 } from './r2';
import { checkUploadType, MAGIC_BYTES_TO_READ, UPLOAD_CATEGORIES, UPLOAD_MAX_BYTES } from './uploadsCalc';
import { asEnum } from './validate';

// Shared by the authenticated upload route (app/api/uploads/route.ts) and the
// unauthenticated patient-portal document upload (app/api/public/patient-portal/[token]),
// so the R2-or-local-storage logic, size/type limits and the uploads row shape only live
// in one place.

// Os limites e a lista branca vivem em lib/uploadsCalc.ts, partilhados com o caminho
// do presign — ver o cabeçalho desse ficheiro. Re-exportados aqui para não partir
// quem já os importava daqui.
export { EXTENSION_FOR_TYPE, UPLOAD_ALLOWED_TYPES, UPLOAD_CATEGORIES, UPLOAD_MAX_BYTES } from './uploadsCalc';

// ─── Onde ficam os ficheiros quando o R2 não está configurado ────────────────
// FORA de `public/`. O Next serve `public/` estaticamente e sem passar por nenhuma
// rota, por isso um ficheiro lá dentro é um ficheiro publicado: bastava ter o
// endereço para abrir um raio-X, um documento de identificação ou um consentimento
// assinado — sem sessão, de qualquer clínica, e mesmo depois de a retenção o ter
// dado por expirado.
//
// Aqui, o único caminho até ao ficheiro é app/api/uploads/[id]/file.
export const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

// ─── E o que já estava gravado no sítio antigo ───────────────────────────────
// As instalações que correram antes desta mudança têm os ficheiros em
// `public/uploads`. Não se movem aqui: mover ficheiros a partir do código da
// aplicação, com um volume do Docker montado por baixo e possivelmente dois
// processos a correr ao mesmo tempo, é como se perdem anexos clínicos.
//
// Em vez disso, a leitura e o apagamento olham para os dois sítios. Os ficheiros
// novos nascem no diretório privado; os antigos continuam a ser servidos — mas agora
// só através da rota, que é o que interessa. Quando a operação os mover (ou quando a
// retenção os tiver apagado a todos), esta constante e os dois sítios que a usam
// saem daqui.
export const LEGACY_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

export interface SaveUploadInput {
  tenantId: string;
  patientId: string | null;
  taskId: string | null;
  categoryRaw: string | null;
  file: File;
}

export type SaveUploadResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export async function saveUploadFile({
  tenantId,
  patientId,
  taskId,
  categoryRaw,
  file,
}: SaveUploadInput): Promise<SaveUploadResult> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return { ok: false, status: 400, error: 'Missing file' };
  }
  const category = categoryRaw ? asEnum(categoryRaw, UPLOAD_CATEGORIES) : 'other';
  if (categoryRaw && !category) {
    return { ok: false, status: 400, error: `category must be one of: ${UPLOAD_CATEGORIES.join(', ')}` };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // O tamanho é verificado ANTES do tipo: ler os bytes de um ficheiro de 4 GB para
  // depois o recusar por ser um .exe é fazer o trabalho pela ordem errada.
  if (buf.length > UPLOAD_MAX_BYTES) {
    return { ok: false, status: 413, error: 'File too large' };
  }

  // Duas verificações, não uma. `canonicalUploadType` sozinho valida o tipo DECLARADO —
  // declarado por quem envia, ou seja, escolhido pelo atacante. checkUploadType confronta
  // essa declaração com os primeiros bytes do ficheiro: é a diferença entre "o cliente
  // disse que é um PNG" e "isto é um PNG". Importa sobretudo aqui, porque este é o
  // caminho que o portal do doente usa — a única superfície onde alguém sem sessão
  // nenhuma consegue escrever um ficheiro no armazenamento da clínica.
  const checked = checkUploadType(file.type, buf.subarray(0, MAGIC_BYTES_TO_READ));
  if (!checked.ok) {
    return { ok: false, status: 400, error: checked.error };
  }
  const type = checked.type;
  const safeExt = checked.extension;

  // O nome que o cliente enviou NÃO participa no nome gravado — nem sequer na
  // extensão. `safeExt` vem da tabela de tipos aceites, exatamente como no caminho
  // do presign. É isto que impede que um ficheiro chamado `x.html` seja servido
  // como HTML a partir de /uploads/ na nossa própria origem.
  const filename = `${crypto.randomUUID()}.${safeExt}`;

  let out: { url: string; storage: string; storageKey: string } | null = null;
  const r2 = getR2Config();
  if (r2) {
    const key = `${tenantId}/${filename}`;
    const uploaded = await putObjectR2({ key, body: buf, contentType: type || 'application/octet-stream' });
    if (uploaded.ok && uploaded.url && uploaded.storageKey) {
      out = { url: uploaded.url, storage: uploaded.storage || 'r2', storageKey: uploaded.storageKey };
    }
  }
  if (!out) {
    // ─── Fora de `public/`, de propósito ──────────────────────────────────
    // Isto gravava em `public/uploads`, que o Next serve estaticamente e sem
    // verificação nenhuma: qualquer pessoa com o endereço abria um raio-X ou um
    // consentimento assinado. Em UPLOADS_DIR, o único caminho até ao ficheiro é
    // app/api/uploads/[id]/file, que confere sessão, clínica e validade.
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(path.join(UPLOADS_DIR, filename), buf);
    out = { url: '', storage: 'local', storageKey: filename };
  }

  const days = Number(process.env.UPLOAD_RETENTION_DAYS || 90);
  const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const [row] = await query(
    `INSERT INTO uploads (tenant_id, patient_id, storage, storage_key, url, content_type, size, expires_at, category, task_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10)
     RETURNING *`,
    [
      tenantId,
      patientId,
      out.storage,
      out.storageKey,
      out.url,
      type || null,
      buf.length,
      expiresAt,
      category || 'other',
      taskId,
    ],
  );

  // ─── O `url` aponta para a rota, nunca para o armazenamento ────────────────
  // Guardava-se aqui `/uploads/<uuid>.<ext>` (o diretório estático do Next) ou o URL
  // público do bucket R2. Nos dois casos, quem tivesse o endereço via o ficheiro sem
  // sessão, de qualquer clínica e mesmo depois de expirado — o controlo de acesso a
  // raios-X e consentimentos era o endereço ser difícil de adivinhar.
  //
  // Agora é sempre app/api/uploads/[id]/file, que confere sessão, clínica e validade
  // a cada pedido. `storage` e `storage_key` continuam a dizer onde o ficheiro está
  // mesmo; só esta coluna é que deixou de o revelar.
  //
  // Em dois passos porque o id só existe depois do INSERT (DEFAULT gen_random_uuid()).
  const publicUrl = `/api/uploads/${row.id}/file`;
  await query(`UPDATE uploads SET url=$1 WHERE id=$2`, [publicUrl, row.id]);
  row.url = publicUrl;

  if (taskId) {
    await completeTask(tenantId, taskId);
  }

  return { ok: true, row };
}

// Remove do armazenamento os ficheiros de um conjunto de chaves. Usado pelo
// apagamento de dados do titular (lib/dataSubject.ts devolve as chaves mas não
// toca em I/O), e é o mesmo caminho para R2 e para disco local — quem chama não
// tem de saber qual está configurado.
export async function deleteStoredFiles(storageKeys: string[]) {
  const r2 = getR2Config();
  let removed = 0;
  const failed: string[] = [];

  for (const key of storageKeys) {
    if (!key) continue;
    if (r2) {
      const res = await deleteObjectR2({ key });
      if (res.ok) removed += 1;
      else failed.push(key);
      continue;
    }
    // Disco local: a chave é o nome do ficheiro, gerado por nós (UUID), nunca
    // um caminho vindo do cliente — mas o basename é barato e fecha a porta a
    // travessia de diretórios se isso alguma vez mudar.
    try {
      // Os dois sítios: o novo e o antigo (ver LEGACY_UPLOADS_DIR). Um apagamento
      // ao abrigo do RGPD não pode deixar a cópia antiga para trás.
      const nome = path.basename(key);
      const resultados = await Promise.allSettled([
        unlink(path.join(UPLOADS_DIR, nome)),
        unlink(path.join(LEGACY_UPLOADS_DIR, nome)),
      ]);
      if (!resultados.some((r) => r.status === 'fulfilled')) throw new Error('nenhum dos caminhos tinha o ficheiro');
      removed += 1;
    } catch {
      // Ficheiro já ausente conta como apagado; qualquer outra falha também não
      // deve impedir o resto do apagamento de prosseguir.
      removed += 1;
    }
  }
  return { removed, failed };
}
