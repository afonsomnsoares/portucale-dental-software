import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { asDate } from '@/lib/validate';

// ─── Cancelamentos ──────────────────────────────────────────────────────────
// A tabela `appointment_cancellations` existe desde a migração 004 e alimenta duas
// coisas importantes — o risco de falta (lib/noShowRisk.ts) e a previsão
// (lib/forecast.ts) — mas nunca teve rota nenhuma. Ou seja: a clínica pagava o custo de
// os registar e nunca os podia ver.
//
// Vai à boleia de 'schedule:read' e não de uma ação nova: quem pode ver a agenda pode
// ver o que saiu dela. Uma permissão a mais que ninguém sabe atribuir é uma
// funcionalidade que ninguém usa.
export const GET = withRoute({ permission: 'schedule:read', tenant: 'required' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const from = asDate(searchParams.get('from'));
  const to = asDate(searchParams.get('to'));

  const vals: unknown[] = [tenantId];
  let filtro = '';
  if (from) {
    vals.push(from);
    filtro += ` AND c.appt_date >= $${vals.length}::date`;
  }
  if (to) {
    vals.push(to);
    filtro += ` AND c.appt_date <= $${vals.length}::date`;
  }

  // `rebooked` responde à única pergunta que interessa sobre um cancelamento: aquela
  // pessoa voltou? Uma consulta marcada DEPOIS do cancelamento conta como recuperada.
  // Sem isto, a lista seria um cemitério — e um cemitério não é acionável.
  const rows = await queryRead(
    `SELECT c.id, c.appt_date, c.start_time, c.duration, c.type, c.chair,
            c.patient_id, c.patient_name, c.created_at,
            u.name AS dentist_name,
            cb.name AS cancelled_by_name,
            EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.patient_id = c.patient_id
                AND a.tenant_id = c.tenant_id
                AND a.created_at > c.created_at
                AND a.status <> 'cancelled'
            ) AS rebooked
     FROM appointment_cancellations c
     LEFT JOIN users u ON u.id = c.dentist_id
     LEFT JOIN users cb ON cb.id = c.cancelled_by
     WHERE c.tenant_id=$1${filtro}
     ORDER BY c.created_at DESC
     LIMIT 300`,
    vals,
  );
  return Response.json(rows);
});
