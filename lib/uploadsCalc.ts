// Limites e decisões puras sobre ficheiros carregados — sem DB, sem I/O, testável
// como lib/inventoryCalc.ts. Existe para que os DOIS caminhos de upload partilhem
// literalmente as mesmas regras, em vez de as reescreverem cada um à sua maneira:
//
//   • multipart pelo servidor  → lib/uploads.ts (saveUploadFile)
//   • PUT direto para o R2     → app/api/uploads/presign/route.ts
//
// Foi a duplicação que abriu o buraco que este ficheiro fecha. O caminho do presign
// já tinha sido corrigido para derivar a extensão do content type validado; o caminho
// multipart continuou a copiar a extensão do nome do ficheiro (controlado por quem
// envia) e a saltar a validação de tipo sempre que o `Content-Type` vinha vazio.
// Combinados, permitiam gravar `<uuid>.html` em public/uploads/ — servido pelo Next
// a partir da PRÓPRIA origem da aplicação, onde a CSP autoriza `script-src 'self'`
// e o cookie dent_csrf é legível por script. Ou seja: XSS armazenado com capacidade
// de agir em nome de quem abrir o ficheiro. Alcançável sem sessão nenhuma, porque o
// portal do paciente (app/api/public/patient-portal/[token]) usa o mesmo saveUploadFile.

export const UPLOAD_MAX_BYTES = 6 * 1024 * 1024;

export const UPLOAD_CATEGORIES = ['id_document', 'xray', 'consent', 'insurance', 'lab_result', 'other'] as const;

// A extensão gravada é sempre escolhida daqui, a partir do content type — nunca do
// nome do ficheiro. As chaves são, ao mesmo tempo, a lista branca de tipos aceites:
// um tipo que não esteja aqui não tem extensão para onde ir, e é por construção
// impossível aceitar um tipo e depois não saber como o nomear.
export const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const UPLOAD_ALLOWED_TYPES = new Set(Object.keys(EXTENSION_FOR_TYPE));

/**
 * O content type em forma canónica (sem parâmetros, em minúsculas), ou null se não
 * estiver na lista branca. É esta forma — nunca a string crua do cliente — que se
 * grava em `uploads.content_type` e se envia ao R2, para que o ficheiro seja depois
 * servido exatamente com o tipo que foi validado.
 *
 * Normaliza antes de decidir porque o cabeçalho chega do cliente: `Content-Type`
 * pode trazer parâmetros (`image/png; charset=binary`) e maiúsculas, e nenhum dos
 * dois deve ser motivo para rejeitar um PNG legítimo — mas também não podem servir
 * para contrabandear um tipo fora da lista.
 *
 * String vazia devolve null, de propósito: um ficheiro sem content type declarado
 * é um ficheiro cujo tipo não conhecemos, e a resposta certa a isso é recusar, não
 * assumir. Era exatamente esse o caso que a verificação antiga (`if (type && ...)`)
 * deixava passar sem olhar.
 */
export function canonicalUploadType(rawType: unknown): string | null {
  const type = String(rawType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!type) return null;
  // Pertença testada contra o Set, nunca com `in` nem com um acesso direto ao objeto:
  // `'constructor' in EXTENSION_FOR_TYPE` é verdadeiro (vem do protótipo) e
  // `EXTENSION_FOR_TYPE['constructor']` devolve uma função, que passaria por
  // "extensão" válida. O Set só conhece as chaves próprias que lhe demos.
  return UPLOAD_ALLOWED_TYPES.has(type) ? type : null;
}

/**
 * A extensão a usar para um content type, ou null se o tipo não for aceite.
 * Mesmas regras de normalização de canonicalUploadType — ver acima.
 */
export function extensionForUploadType(rawType: unknown): string | null {
  const type = canonicalUploadType(rawType);
  return type ? EXTENSION_FOR_TYPE[type] : null;
}

// ─── Verificação de assinatura (magic bytes) ────────────────────────────────
// A lista branca acima valida o `Content-Type` DECLARADO. Declarado por quem envia — o
// que quer dizer que o atacante escolhe o valor que vai ser validado. Um ficheiro HTML
// enviado com `Content-Type: image/png` passava por todas as verificações anteriores,
// era gravado como `<uuid>.png` e servido com esse tipo... o que, sozinho, já não é
// executável no browser. O buraco real é outro e é mais subtil:
//
//   • o R2 serve o ficheiro com o tipo que lhe demos, mas um bucket mal configurado (ou
//     um proxy pelo meio) pode fazer sniffing e servir HTML;
//   • um PDF que na verdade é um ZIP com um payload passa igualmente, e o que se
//     distribui a partir daí não é problema nosso mas é responsabilidade nossa;
//   • e sobretudo: o portal do doente (app/api/public/patient-portal/[token]) aceita
//     uploads SEM SESSÃO NENHUMA. É a única superfície da aplicação onde alguém sem
//     conta consegue escrever um ficheiro no armazenamento da clínica.
//
// Verificar os primeiros bytes fecha a diferença entre "o cliente disse que é um PNG" e
// "isto é um PNG". Não é antivírus e não pretende ser — é a verificação de coerência
// mínima que impede que o tipo gravado seja uma ficção escolhida por quem envia.

// Assinaturas dos quatro tipos aceites. Cada entrada é uma lista de alternativas porque
// alguns formatos têm mais do que uma abertura válida (JPEG tem três variantes comuns).
// `offset` existe para o WebP, cuja assinatura não começa no byte 0.
const MAGIC_SIGNATURES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/jpeg': [
    { offset: 0, bytes: [0xff, 0xd8, 0xff, 0xe0] }, // JFIF
    { offset: 0, bytes: [0xff, 0xd8, 0xff, 0xe1] }, // EXIF
    { offset: 0, bytes: [0xff, 0xd8, 0xff, 0xdb] }, // sem cabeçalho de aplicação
    { offset: 0, bytes: [0xff, 0xd8, 0xff, 0xee] }, // Adobe
  ],
  // RIFF....WEBP — o tamanho do ficheiro ocupa os bytes 4-7 e não faz parte da
  // assinatura, por isso são duas verificações em posições diferentes.
  'image/webp': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }], // %PDF-
};

// Quantos bytes é preciso ler para decidir. O maior offset+comprimento em uso é o do
// WebP (12); arredondado para dar folga a assinaturas futuras sem mexer nos chamadores.
export const MAGIC_BYTES_TO_READ = 16;

function matches(head: Uint8Array, sig: { offset: number; bytes: number[] }): boolean {
  if (head.length < sig.offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => head[sig.offset + i] === b);
}

/**
 * O ficheiro começa mesmo como o tipo declarado diz? Recebe só os primeiros bytes —
 * quem chama não tem de carregar o ficheiro inteiro para fazer esta pergunta, e o
 * caminho do presign nem sequer chega a ter o ficheiro.
 *
 * Devolve false para um tipo fora da lista branca: um tipo que não sabemos verificar é
 * um tipo que não aceitamos, e não o contrário.
 */
export function magicBytesMatch(canonicalType: string, head: Uint8Array): boolean {
  const signatures = MAGIC_SIGNATURES[canonicalType];
  if (!signatures) return false;
  if (!signatures.some((sig) => matches(head, sig))) return false;

  // O RIFF sozinho não distingue um WebP de um WAV ou de um AVI — todos começam por
  // RIFF. O que identifica o WebP é o 'WEBP' no byte 8, depois do tamanho.
  if (canonicalType === 'image/webp') {
    const webp = [0x57, 0x45, 0x42, 0x50];
    return matches(head, { offset: 8, bytes: webp });
  }
  return true;
}

/**
 * A verificação completa de um ficheiro recebido pelo servidor: tipo declarado dentro
 * da lista branca E conteúdo coerente com ele. Devolve o tipo canónico, ou o motivo
 * pelo qual foi recusado — em português, porque a mensagem chega ao doente no portal.
 */
export type UploadTypeCheck = { ok: true; type: string; extension: string } | { ok: false; error: string };

export function checkUploadType(rawType: unknown, head: Uint8Array): UploadTypeCheck {
  const type = canonicalUploadType(rawType);
  if (!type) return { ok: false, error: 'Tipo de ficheiro não suportado.' };
  if (!magicBytesMatch(type, head)) {
    // Deliberadamente não diz o que o ficheiro é na verdade: seria dar a quem tenta
    // um oráculo para descobrir que assinaturas passam.
    return { ok: false, error: 'O conteúdo do ficheiro não corresponde ao tipo indicado.' };
  }
  return { ok: true, type, extension: EXTENSION_FOR_TYPE[type] };
}
