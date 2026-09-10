import { forbidden, requireRoles } from '@/lib/auth';
import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute(
  {
    authOnly:
      'Lista de dentistas da própria clínica: nome e id, sem dados de doente. É o que enche o seletor de qualquer marcação, por isso toda a gente que marca precisa dela',
    tenant: 'optional',
  },
  async ({ user }) => {
    if (!requireRoles(user, 'admin', 'super_admin', 'receptionist')) return forbidden();

    const rows = await query(
      `SELECT id, name, email, specialties
     FROM users
     WHERE role='dentist' AND active=TRUE AND tenant_id=$1
     ORDER BY name`,
      [user.tenantId],
    );

    return Response.json(rows);
  },
);
