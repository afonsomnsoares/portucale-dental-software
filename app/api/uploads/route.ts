import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getR2Config, putObjectR2 } from '@/lib/r2';
import { getOwnedPatient } from '@/lib/tenantGuard';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;

  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'uploads:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const form = await request.formData();
  const file = form.get('file') as File;
  const patientId = form.get('patientId') ? String(form.get('patientId')) : null;
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Missing file' }, { status: 400 });
  }
  if (patientId && !(await getOwnedPatient(patientId, user))) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const type = String(file.type || '');
  if (type && !ALLOWED.has(type)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return Response.json({ error: 'File too large' }, { status: 413 });
  }

  const original = String(file.name || 'upload');
  const extRaw = path.extname(original).slice(1).toLowerCase();
  const safeExt = extRaw && extRaw.length <= 8 ? extRaw : type === 'application/pdf' ? 'pdf' : 'bin';
  const filename = `${crypto.randomUUID()}.${safeExt}`;

  let out = null;
  const r2 = getR2Config();
  if (r2) {
    const key = `${user.tenantId}/${filename}`;
    const uploaded = await putObjectR2({ key, body: buf, contentType: type || 'application/octet-stream' });
    if (uploaded.ok) out = uploaded;
  }

  if (!out) {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), buf);
    out = { ok: true, url: `/uploads/${filename}`, storage: 'local', storageKey: filename };
  }

  const days = Number(process.env.UPLOAD_RETENTION_DAYS || 90);
  const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const [row] = await query(
    `INSERT INTO uploads (tenant_id, patient_id, storage, storage_key, url, content_type, size, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
     RETURNING *`,
    [user.tenantId, patientId, out.storage, out.storageKey, out.url, type || null, buf.length, expiresAt],
  );

  return Response.json(
    {
      url: out.url,
      name: original,
      size: buf.length,
      type,
      uploadId: row?.id,
    },
    { status: 201 },
  );
}
