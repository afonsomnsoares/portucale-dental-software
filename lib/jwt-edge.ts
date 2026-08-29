export interface EdgeSessionUser {
  id: string;
  name: string;
  role: string;
  clinic?: string | null;
  tenantId?: string | null;
}

function getJwtSecrets() {
  const rawSecrets = (process.env.JWT_SECRETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const single = String(process.env.JWT_SECRET || '').trim();
  const secrets = single ? [single, ...rawSecrets] : rawSecrets;
  const uniq: string[] = [];
  for (const s of secrets) {
    if (!uniq.includes(s)) uniq.push(s);
  }
  return uniq;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacB64url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

// Web Crypto mirror of verifyToken() from lib/auth.ts — usable in Edge middleware
export async function verifyTokenEdge(token: string): Promise<EdgeSessionUser | null> {
  if (!token) return null;
  try {
    const [hdr, bdy, sig] = token.split('.');
    if (!hdr || !bdy || !sig) return null;
    const secrets = getJwtSecrets();
    if (secrets.length === 0) return null;
    let ok = false;
    for (const secret of secrets) {
      const expected = await hmacB64url(secret, `${hdr}.${bdy}`);
      if (constantTimeEqual(sig, expected)) {
        ok = true;
        break;
      }
    }
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(bdy))) as EdgeSessionUser & {
      nbf?: number;
      exp?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (payload?.nbf && now < Number(payload.nbf)) return null;
    if (payload?.exp && now >= Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}
