import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { badRequest } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { getR2Config, presignPutObjectR2 } from '@/lib/r2';
import { UPLOAD_ALLOWED_TYPES, UPLOAD_MAX_BYTES } from '@/lib/uploads';
import { asInt } from '@/lib/validate';

// Extension is derived from the (already allowlisted) content type, never from the
// caller's filename: the filename is attacker-controlled and the old code copied any
// extension up to 8 characters straight into the stored key. Since the allowlist has
// exactly four entries, a lookup is both simpler and impossible to get wrong.
const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// Direct-to-R2 upload, for files too large to round-trip through the server. It is the
// sibling of the multipart path in app/api/uploads/route.ts (lib/uploads.ts's
// saveUploadFile) and must apply the SAME limits — until this was fixed it applied
// none: contentType came off the query string unvalidated, any extension was accepted,
// and nothing bounded the size, so the one path that skips the server also skipped
// every check the other one performs.
//
// Both limits are enforced by the signature itself (see presignPutObjectR2), not just
// checked here — rejecting early gives the caller a clear error, but the reason a
// caller cannot simply ignore this route's opinion is that R2 refuses the PUT.
export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'uploads:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const cfg = getR2Config();
  if (!cfg) return Response.json({ error: 'R2 not configured' }, { status: 400 });

  const { searchParams } = new URL(request.url);

  const contentType = String(searchParams.get('contentType') || '')
    .trim()
    .toLowerCase();
  if (!UPLOAD_ALLOWED_TYPES.has(contentType)) {
    return badRequest('Unsupported file type', { allowed: Array.from(UPLOAD_ALLOWED_TYPES) });
  }

  // Required, because the signature binds it: without a size there is nothing to stop
  // a 500 MB PUT against a URL issued for a small image.
  const contentLength = asInt(searchParams.get('contentLength'), { min: 1, max: UPLOAD_MAX_BYTES });
  if (contentLength === null) {
    return badRequest(`contentLength is required and must be between 1 and ${UPLOAD_MAX_BYTES} bytes`, {
      maxBytes: UPLOAD_MAX_BYTES,
    });
  }

  const filename = `${crypto.randomUUID()}.${EXTENSION_FOR_TYPE[contentType]}`;
  const key = `${user.tenantId}/${filename}`;
  const presigned = presignPutObjectR2({ key, contentType, contentLength, expiresSeconds: 900 });
  if (!presigned) return Response.json({ error: 'R2 not configured' }, { status: 400 });

  return Response.json({ key, ...presigned });
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  return Response.json({ error: 'Use GET' }, { status: 405 });
}
