import { queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute<{ id: string }>(
  { permission: 'consent-forms:read', tenant: 'optional' },
  async ({ user, params }) => {
    const { id } = params;

    const row = await queryOne(
      `SELECT cf.*, p.name AS patient_name
     FROM consent_forms cf
     JOIN patients p ON p.id = cf.patient_id
     WHERE cf.id=$1 AND ($2::uuid IS NULL OR cf.tenant_id=$2::uuid)`,
      [id, user.tenantId || null],
    );

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(row);
  },
);
