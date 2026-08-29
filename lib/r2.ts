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

export function presignPutObjectR2({
  key,
  contentType,
  expiresSeconds = 900,
}: {
  key: string;
  contentType?: string;
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
  queryParams.set('X-Amz-SignedHeaders', 'host');

  const canonicalQuery = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${awsEncodeURIComponent(k)}=${awsEncodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    canonicalPath(objectPath),
    canonicalQuery,
    `host:${host}\n`,
    'host',
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
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
    },
  };
}
