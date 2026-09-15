import { forbidden, requireRoles } from '@/lib/auth';
import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'audit:read', tenant: 'optional' }, async ({ request, user, tenantId }) => {
  if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const q = searchParams.get('q');

  // ─── O isolamento é por tenant_id, não pelo nome da clínica ────────────────
  // Isto filtrava por `user.clinic`, que é texto livre escrito num <input> e vinha
  // por omissão a 'Main'/'Main Clinic'. Duas clínicas que ficassem com o nome por
  // omissão liam o registo uma da outra — sem ataque nenhum, e com nomes de doentes
  // e medicamentos lá dentro. Ver scripts/migrations/056_audit_log_tenant_id.sql.
  //
  // A política de RLS da 056 já recusa as linhas de outra clínica mesmo que esta
  // cláusula desapareça; fica aqui à mesma para que a consulta diga o que quer, e
  // porque o super-admin corre com is_super_admin=true e atravessa a política.
  let sql = `SELECT * FROM audit_log WHERE 1=1`;
  const vals: unknown[] = [];
  if (action) {
    vals.push(action);
    sql += ` AND action=$${vals.length}`;
  }
  if (tenantId) {
    vals.push(tenantId);
    sql += ` AND tenant_id=$${vals.length}::uuid`;
  } else {
    // Só o super-admin chega aqui (tenant: 'optional' + requireRoles acima). O
    // ?clinic= continua a ser dele, agora como filtro de conveniência sobre o rótulo.
    const clinic = searchParams.get('clinic');
    if (clinic) {
      vals.push(clinic);
      sql += ` AND clinic=$${vals.length}`;
    }
  }
  if (q) {
    vals.push(`%${q}%`);
    sql += ` AND (resource ILIKE $${vals.length} OR user_name ILIKE $${vals.length})`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 200`;

  return Response.json(await queryRead(sql, vals));
});
