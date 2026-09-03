import crypto from 'node:crypto';

type R2Body = Buffer | string;

function hmac(key: crypto.BinaryLike, msg: crypto.BinaryLike, encoding?: crypto.BinaryToTextEncoding) {
  const h = crypto.createHmac('sha256', key).update(msg);
  return encoding ? h.digest(encoding) : h.digest();
}

function sha256Hex(buf: crypto.BinaryLike) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function awsEncodeURIComponent(str: string) {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(pathname: string) {
  return pathname
    .split('/')
    .map((p) => awsEncodeURIComponent(p))
    .join('/');
}

function getSigningKey(secret: string, date: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export function getR2Config() {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

export async function putObjectR2({ key, body, contentType }: { key: string; body: R2Body; contentType?: string }) {
  const cfg = getR2Config();
  if (!cfg) return { ok: false as const, error: 'R2 not configured' };

  const region = 'auto';
  const service = 's3';

  const url = new URL(cfg.endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const objectPath = `/${cfg.bucket}/${key}`;
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    'content-type': contentType || 'application/octet-stream',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${String(headers[k]).trim()}\n`)
    .join('');
  const canonicalRequest = ['PUT', canonicalPath(objectPath), '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest))].join(
    '\n',
  );

  const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  let res: Response | { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetch(`${url.origin}${objectPath}`, {
      method: 'PUT',
      headers: {
        ...headers,
        Authorization: authorization,
      },
      body: body as BodyInit,
    });
  } catch (e) {
    res = { ok: false, status: 0, text: async () => (e instanceof Error ? e.message : 'Network error') };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: t || `R2 upload error (${res.status})` };
  }

  const publicUrl = cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl.replace(/\/+$/, '')}/${key}`
    : `${url.origin}${objectPath}`;

  return { ok: true, url: publicUrl, storage: 'r2', storageKey: key };
}

// Apaga um objeto do bucket. Necessário para o direito ao apagamento (RGPD art.
// 17.º): sem isto, `erasePatient` remove as linhas de `uploads` e os ficheiros
// ficam no R2 para sempre — dados pessoais que a clínica jurou ter apagado.
// Mesma assinatura SigV4 do putObjectR2 acima; o payload de um DELETE é vazio.
export async function deleteObjectR2({ key }: { key: string }) {
  const cfg = getR2Config();
  if (!cfg) return { ok: false as const, error: 'R2 not configured' };

  const region = 'auto';
  const service = 's3';
  const url = new URL(cfg.endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const objectPath = `/${cfg.bucket}/${key}`;
  const payloadHash = sha256Hex(Buffer.from(''));

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${String(headers[k]).trim()}\n`)
    .join('');
  const canonicalRequest = ['DELETE', canonicalPath(objectPath), '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest))].join(
    '\n',
  );
  const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(`${url.origin}${objectPath}`, {
      method: 'DELETE',
      headers: { ...headers, Authorization: authorization },
    });
    // O S3 devolve 204 quando apaga e quando a chave já não existia — ambos são
    // o resultado que queremos.
    if (!res.ok && res.status !== 404) {
      return { ok: false as const, error: `R2 delete error (${res.status})` };
    }
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// `contentType` and `contentLength` are part of the SIGNATURE, not a hint to the
// client. Until this was fixed they were neither: X-Amz-SignedHeaders was just
// 'host' and contentType was echoed back in `headers` for the caller to use if it
// felt like it — so a presigned URL issued for a 2 MB image would happily accept a
// 500 MB executable, and the allowlist that app/api/uploads/route.ts enforces on
// the server-side path had no equivalent here at all.
//
// Putting both headers in SignedHeaders makes R2 itself reject a PUT whose
// Content-Type or Content-Length differ from what was signed, which is what turns
// the check in app/api/uploads/presign/route.ts from advisory into enforced. The
// caller must send exactly the returned `headers` — hence contentLength being
// required: the browser knows File.size before uploading, and a signature that
// bound only the type would still leave size unbounded.
export function presignPutObjectR2({
  key,
  contentType,
  contentLength,
  expiresSeconds = 900,
}: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresSeconds?: number;
}) {
  const cfg = getR2Config();
  if (!cfg) return null;

  const region = 'auto';
  const service = 's3';

  const url = new URL(cfg.endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${cfg.accessKeyId}/${credentialScope}`;

  const objectPath = `/${cfg.bucket}/${key}`;

  const queryParams = new URLSearchParams();
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  queryParams.set('X-Amz-Credential', credential);
  queryParams.set('X-Amz-Date', amzDate);
  queryParams.set('X-Amz-Expires', String(Math.max(60, Math.min(3600, Number(expiresSeconds) || 900))));
  // SigV4 canonical headers: lowercase names, trimmed values, sorted by name —
  // 'content-length' < 'content-type' < 'host' alphabetically, which is the order
  // both the canonical block and SignedHeaders must use.
  const signedContentType = String(contentType).trim();
  const signedContentLength = String(Math.trunc(Number(contentLength)));
  queryParams.set('X-Amz-SignedHeaders', 'content-length;content-type;host');

  const canonicalQuery = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${awsEncodeURIComponent(k)}=${awsEncodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    canonicalPath(objectPath),
    canonicalQuery,
    `content-length:${signedContentLength}\ncontent-type:${signedContentType}\nhost:${host}\n`,
    'content-length;content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest))].join(
    '\n',
  );

  const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  queryParams.set('X-Amz-Signature', signature);

  const uploadUrl = `${url.origin}${objectPath}?${queryParams.toString()}`;
  const publicUrl = cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl.replace(/\/+$/, '')}/${key}`
    : `${url.origin}${objectPath}`;

  return {
    uploadUrl,
    publicUrl,
    // Not a suggestion — the signature covers both, so a PUT that sends anything
    // else is rejected by R2 before a byte is stored.
    headers: {
      'Content-Type': signedContentType,
      'Content-Length': signedContentLength,
    },
  };
}
