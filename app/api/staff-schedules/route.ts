import { appendAudit } from '@/lib/audit';
import { query, queryOne, queryRead } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { asEnum, asTime } from '@/lib/validate';

// GET is open to any authenticated tenant member (not gated on
// 'staff-schedules:manage') — a shift schedule is operational info everyone on the team
// benefits from seeing ("who's in today"), not something to lock down. Only writing one
// (POST here, DELETE at [id]) requires the permission.
export const GET = withRoute(
  { authOnly: 'Configuração da própria clínica', tenant: 'resolved' },
  async ({ request, tenantId }) => {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const vals: unknown[] = [tenantId];
    let sql = `
    SELECT s.*, u.name AS user_name, u.role
    FROM staff_schedules s JOIN users u ON u.id = s.user_id
    WHERE s.tenant_id=$1`;
    if (userId) {
      vals.push(userId);
      sql += ` AND s.user_id=$${vals.length}`;
    }
    sql += ' ORDER BY u.name, s.weekday, s.start_time';

    const rows = await queryRead(sql, vals);
    return Response.json(rows);
  },
);

export const POST = withRoute(
  { permission: 'staff-schedules:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    if (!tenantId) return badRequest('tenantId is required');
    if (!body.userId) return badRequest('userId is required');
    const weekday = asEnum(String(body.weekday), ['0', '1', '2', '3', '4', '5', '6']);
    if (weekday === null) return badRequest('weekday must be 0-6');
    const startTime = asTime(body.startTime);
    const endTime = asTime(body.endTime);
    if (!startTime || !endTime) return badRequest('startTime/endTime must be HH:MM');
    if (endTime <= startTime) return badRequest('endTime must be after startTime');

    const target = await queryOne(`SELECT id, name FROM users WHERE id=$1 AND tenant_id=$2`, [body.userId, tenantId]);
    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

    const [row] = await query(
      `INSERT INTO staff_schedules (tenant_id, user_id, weekday, start_time, end_time, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
      [tenantId, body.userId, Number(weekday), startTime, endTime, user.id],
    );

    await appendAudit(
      user,
      'CREATE',
      `Staff schedule: ${target.name}`,
      null,
      `weekday ${weekday} ${startTime}-${endTime}`,
      user.clinic,
    );

    return created({ ...row, user_name: target.name });
  },
);
