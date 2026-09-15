import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { notFound } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';

export const GET = withRoute<{ id: string }>(
  { permission: 'medical-history:read', tenant: 'optional' },
  async ({ params, tenantId }) => {
    const { id } = params;

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
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    const body = await request.json();

    const { allergies, medications, conditions, family_history, smoking, pregnancy, notes } = body;

    // Esta rota era a única sub-rota de doente sem verificação de posse — as irmãs
    // (notes, uploads, consent-forms, prescriptions, scheduling-prefs) chamam todas
    // getOwnedPatient. Até aqui falhava fechada por acidente: `tenant_id` é NOT NULL
    // sem default, por isso o INSERT abaixo rebentava com 23502 em TODAS as chamadas,
    // e a anamnese nunca chegou a gravar. Corrigir só a coluna teria transformado um
    // 500 numa escrita clínica entre clínicas — por isso as duas coisas mudam juntas.
    const patient = await getOwnedPatient(id, { tenantId });
    if (!patient) return notFound('Patient not found');

    // O tenant vem do doente, não de `tenantId`: para um super-admin `tenantId` é null,
    // e a coluna não o aceita. É também a única fonte que não se deixa influenciar
    // pelo corpo do pedido.
    const [row] = await query(
      `INSERT INTO medical_history (patient_id, tenant_id, allergies, medications, conditions, family_history, smoking, pregnancy, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (patient_id)
     DO UPDATE SET allergies=EXCLUDED.allergies, medications=EXCLUDED.medications,
       conditions=EXCLUDED.conditions, family_history=EXCLUDED.family_history,
       smoking=EXCLUDED.smoking, pregnancy=EXCLUDED.pregnancy, notes=EXCLUDED.notes,
       updated_by=EXCLUDED.updated_by, updated_at=NOW()
     RETURNING *`,
      [
        id,
        patient.tenant_id,
        allergies || '',
        medications || '',
        conditions || '',
        family_history || '',
        smoking || '',
        pregnancy || '',
        notes || '',
        user.id,
      ],
    );

    await appendAudit(user, 'UPDATE', 'Medical history', null, `patient:${id}`, user.clinic);
    return Response.json(row);
  },
);
