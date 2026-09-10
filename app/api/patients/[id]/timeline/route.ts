import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute<{ id: string }>(
  {
    authOnly: 'Histórico de eventos de um doente da própria clínica, já filtrado por getOwnedPatient',
    tenant: 'optional',
  },
  async ({ user, params }) => {
    const { id } = params;
    const tenantId = user.tenantId;
    const rows = await query(
      `SELECT pt.* FROM patient_timeline pt
     JOIN patients p ON p.id = pt.patient_id
     WHERE pt.patient_id=$1 AND ($2::uuid IS NULL OR p.tenant_id=$2::uuid)
     ORDER BY pt.created_at DESC`,
      [id, tenantId],
    );
    return Response.json(rows);
  },
);
