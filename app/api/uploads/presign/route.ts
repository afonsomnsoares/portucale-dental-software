import crypto from 'node:crypto';
import { forbidden } from '@/lib/auth';
import { badRequest } from '@/lib/http';
import { getR2Config, presignPutObjectR2 } from '@/lib/r2';
import { withRoute } from '@/lib/route';
import { EXTENSION_FOR_TYPE, UPLOAD_ALLOWED_TYPES, UPLOAD_MAX_BYTES } from '@/lib/uploadsCalc';
import { asInt } from '@/lib/validate';

// A extensão deriva do content type (já na lista branca), nunca do nome do ficheiro:
// o nome é controlado por quem envia. A tabela mudou-se para lib/uploadsCalc.ts, para
// que o caminho multipart (lib/uploads.ts) use exatamente a mesma — era estar em dois
// sítios que deixava o outro caminho por corrigir.

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
export const GET = withRoute({ permission: 'uploads:create', tenant: 'optional' }, async ({ request, user }) => {
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
});

export const POST = withRoute({ permission: 'uploads:create' }, async () =>
  Response.json({ error: 'Use GET' }, { status: 405 }),
);
