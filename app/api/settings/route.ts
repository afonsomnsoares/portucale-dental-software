import { query } from '@/lib/db';
import { withRoute } from '@/lib/route';

export const GET = withRoute(
  {
    authOnly:
      'Catálogos da própria clínica (códigos de tratamento e estados). São a tabela de referência que a interface precisa para desenhar seja o que for',
    tenant: 'optional',
  },
  async ({ tenantId }) => {
    // Catálogos por clínica (migração 035): cada tabela tem a linha global
    // (tenant_id NULL) e, opcionalmente, o override desta clínica. O DISTINCT ON
    // com `(tenant_id IS NOT NULL) DESC` no ORDER BY escolhe o override quando
    // existe e cai no global quando não existe — uma clínica só precisa de
    // inserir os códigos que quer repricar, não o catálogo inteiro.
    const [treatmentCodes, statuses] = await Promise.all([
      query(
        `SELECT DISTINCT ON (code) code, description AS desc, category, fee
         FROM treatment_codes
        WHERE tenant_id IS NULL OR tenant_id = $1::uuid
        ORDER BY code, (tenant_id IS NOT NULL) DESC`,
        [tenantId],
      ),
      query(
        `SELECT DISTINCT ON (key) key, label, bg, color, transitions
         FROM statuses
        WHERE tenant_id IS NULL OR tenant_id = $1::uuid
        ORDER BY key, (tenant_id IS NOT NULL) DESC`,
        [tenantId],
      ),
    ]);

    const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {};
    const STATUS_TRANSITIONS: Record<string, string[]> = {};

    for (const s of statuses) {
      STATUS_META[s.key] = { label: s.label, bg: s.bg, color: s.color };
      STATUS_TRANSITIONS[s.key] = s.transitions || [];
    }

    return Response.json({
      TANOMD_CODES: treatmentCodes,
      STATUS_META,
      STATUS_TRANSITIONS,
    });
  },
);
