import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Números de cabeçalho do dashboard. Os de clínica saem sempre filtrados pela
// clínica de quem chama; os dois de plataforma — quantas clínicas existem, quantas
// estão ativas — só são calculados para o super-admin.
//
// A verificação de papel não é redundante com a RLS. A política de `tenants` é
// chaveada em `id`, por isso um `SELECT COUNT(*) FROM tenants` sem filtro
// devolveria 1 a uma rececionista — o número certo, mas porque a base o cortou e
// não porque alguém o decidiu. Uma resposta certa por acidente não é defesa.
//
// Quem lê estes dois números é só components/super-admin/pages/Overview.tsx.
export const GET = withRoute(
  {
    authOnly:
      'Contadores do próprio dashboard, já filtrados pela clínica de quem chama; ' +
      'os números de plataforma são calculados só para o super-admin, abaixo',
    tenant: 'optional',
  },
  async ({ user, tenantId }) => {
    const filter = tenantId ? 'WHERE tenant_id=$1' : '';
    const params = tenantId ? [tenantId] : [];

    const [patients] = await queryRead(`SELECT COUNT(*) FROM patients ${filter}`, params);
    const [outstanding] = await queryRead(`SELECT COALESCE(SUM(balance),0) as total FROM patients ${filter}`, params);
    const [highRisk] = await queryRead(
      `SELECT COUNT(*)::int AS count
     FROM appointments a JOIN patients p ON p.id=a.patient_id
     WHERE a.appt_date=CURRENT_DATE ${tenantId ? 'AND a.tenant_id=$1' : ''}
       AND (ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100) >= 60)`,
      params,
    );

    // null, e não 0: quem lê isto distingue "não te diz respeito" de "são zero".
    let activeClinics: number | null = null;
    let totalTenants: number | null = null;
    if (user.role === 'super_admin') {
      const [active] = await queryRead(`SELECT COUNT(*) FROM tenants WHERE status='active'`);
      const [all] = await queryRead(`SELECT COUNT(*) FROM tenants`);
      activeClinics = Number(active.count);
      totalTenants = Number(all.count);
    }

    return Response.json({
      activeClinics,
      totalTenants,
      totalPatients: Number(patients.count),
      outstanding: Number(outstanding.total),
      highRisk: Number(highRisk.count),
    });
  },
);
