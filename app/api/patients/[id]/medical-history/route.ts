import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'medical-history:read'))) return forbidden();
  const { id } = await params;
  const tenantId = user.tenantId;

  const row = await queryOne(
    `SELECT mh.allergies, mh.medications, mh.conditions, mh.family_history, mh.smoking, mh.pregnancy, mh.notes
     FROM medical_history mh
     JOIN patients p ON p.id = mh.patient_id
     WHERE mh.patient_id=$1 AND ($2::uuid IS NULL OR p.tenant_id=$2::uuid)`,
    [id, tenantId],
  );

  if (!row) {
    return Response.json({
      allergies: '',
      medications: '',
      conditions: '',
      family_history: '',
      smoking: '',
      pregnancy: '',
      notes: '',
    });
  }

  return Response.json(row);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'medical-history:manage'))) return forbidden();
  const { id } = await params;
  const body = await request.json();

  const { allergies, medications, conditions, family_history, smoking, pregnancy, notes } = body;

  const [row] = await query(
    `INSERT INTO medical_history (patient_id, allergies, medications, conditions, family_history, smoking, pregnancy, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (patient_id)
     DO UPDATE SET allergies=EXCLUDED.allergies, medications=EXCLUDED.medications,
       conditions=EXCLUDED.conditions, family_history=EXCLUDED.family_history,
       smoking=EXCLUDED.smoking, pregnancy=EXCLUDED.pregnancy, notes=EXCLUDED.notes,
       updated_at=NOW()
     RETURNING *`,
    [
      id,
      allergies || '',
      medications || '',
      conditions || '',
      family_history || '',
      smoking || '',
      pregnancy || '',
      notes || '',
    ],
  );

  await appendAudit(user, 'UPDATE', 'Medical history', null, `patient:${id}`, user.clinic);
  return Response.json(row);
}
