import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from './db';
import { completeTask } from './patientTasks';
import { getR2Config, putObjectR2 } from './r2';
import { asEnum } from './validate';

// Shared by the authenticated upload route (app/api/uploads/route.ts) and the
// unauthenticated patient-portal document upload (app/api/public/patient-portal/[token]),
// so the R2-or-local-storage logic, size/type limits and the uploads row shape only live
// in one place.

export const UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const UPLOAD_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
export const UPLOAD_CATEGORIES = ['id_document', 'xray', 'consent', 'insurance', 'lab_result', 'other'] as const;

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

  const type = String(file.type || '');
  if (type && !UPLOAD_ALLOWED_TYPES.has(type)) {
    return { ok: false, status: 400, error: 'Unsupported file type' };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > UPLOAD_MAX_BYTES) {
    return { ok: false, status: 413, error: 'File too large' };
  }

  const original = String(file.name || 'upload');
  const extRaw = path.extname(original).slice(1).toLowerCase();
  const safeExt = extRaw && extRaw.length <= 8 ? extRaw : type === 'application/pdf' ? 'pdf' : 'bin';
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
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), buf);
    out = { url: `/uploads/${filename}`, storage: 'local', storageKey: filename };
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

  if (taskId) {
    await completeTask(tenantId, taskId);
  }

  return { ok: true, row };
}
