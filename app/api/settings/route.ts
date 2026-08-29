import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();

  const [treatmentCodes, conditions, statuses] = await Promise.all([
    query('SELECT code, description AS desc, category, fee FROM treatment_codes ORDER BY code'),
    query('SELECT key, label, color FROM tooth_conditions ORDER BY key'),
    query('SELECT key, label, bg, color, transitions FROM statuses ORDER BY key'),
  ]);

  const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {};
  const STATUS_TRANSITIONS: Record<string, string[]> = {};

  for (const s of statuses) {
    STATUS_META[s.key] = { label: s.label, bg: s.bg, color: s.color };
    STATUS_TRANSITIONS[s.key] = s.transitions || [];
  }

  return Response.json({
    TANOMD_CODES: treatmentCodes,
    TOOTH_CONDITIONS: conditions,
    STATUS_META,
    STATUS_TRANSITIONS,
  });
}
