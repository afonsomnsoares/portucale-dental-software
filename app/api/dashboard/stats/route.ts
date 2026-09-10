import { queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';

// Números de cabeçalho do dashboard. Os de clínica saem sempre filtrados pela
// clínica de quem chama; os dois de plataforma — quantas clínicas existem, quantas
// estão ativas — só são calculados para o super-admin.
//
// Antes eram calculados para toda a gente: `SELECT COUNT(*) FROM tenants` sem
// filtro nem verificação. Na prática a RLS salvava-o (a política de `tenants` é
// chaveada em `id`, por isso uma rececionista contava a sua própria clínica e mais
// nenhuma), mas era a única rota do projeto onde a RLS era a ÚNICA linha de defesa
// em vez da segunda — e uma resposta que devolve 1 porque a base a cortou, e não
// porque alguém decidiu, é uma resposta certa por acidente. Quem os lê é só
// components/super-admin/pages/Overview.tsx.
export const GET = withRoute(
  {
    authOnly:
      'Contadores do próprio dashboard, já filtrados pela clínica de quem chama; ' +
      'os números de plataforma são calculados só para o super-admin, abaixo',
    tenant: 'optional',
  },
  async ({ user }) => {
    const tenantId = user.tenantId || null;
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
