import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute<{ id: string }>(
  { permission: 'medical-history:read', tenant: 'optional' },
  async ({ user, params }) => {
    const { id } = params;
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
  },
);

export const PUT = withRoute<{ id: string }>(
  { permission: 'medical-history:manage', tenant: 'optional' },
  async ({ request, user, params }) => {
    const { id } = params;
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
  },
);
