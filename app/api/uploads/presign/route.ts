import crypto from 'node:crypto';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getR2Config, presignPutObjectR2 } from '@/lib/r2';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'uploads:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const cfg = getR2Config();
  if (!cfg) return Response.json({ error: 'R2 not configured' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const contentType = searchParams.get('contentType') || 'application/octet-stream';
  const original = searchParams.get('filename') || 'upload';
  const extRaw = path.extname(original).slice(1).toLowerCase();
  const safeExt = extRaw && extRaw.length <= 8 ? extRaw : 'bin';
  const filename = `${crypto.randomUUID()}.${safeExt}`;
  const key = `${user.tenantId}/${filename}`;
  const presigned = presignPutObjectR2({ key, contentType, expiresSeconds: 900 });
  return Response.json({ key, ...presigned });
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  return Response.json({ error: 'Use GET' }, { status: 405 });
}
