import { appendAudit } from '@/lib/audit';
import { query } from '@/lib/db';
import { inactiveAfterMonths } from '@/lib/lifecycle';
import { DEFAULT_INACTIVE_MONTHS, lifecycleStages } from '@/lib/lifecycleCalc';
import { withRoute } from '@/lib/route';

// ─── Quando é que um doente conta como desaparecido ─────────────────────────
// Ler vai com 'lifecycle:read', que a receção já tem — o número explica a coluna
// «Desaparecido» que ela vê todos os dias. Escrever exige 'lifecycle:configure': mudar
// este número reclassifica a base de doentes inteira de uma vez, decide quem entra em
// campanha de reativação e move a categoria «Pacientes inativos» do ecrã de recuperação.
// Mesmo desenho e mesma razão que 'costs:manage' em app/api/finance/cost-settings.

// Os mesmos limites do CHECK da migração 060. Repetidos aqui de propósito: a base
// devolveria 23514 e a rota um 500 — o mesmo travão, mas a dizer «erro do servidor» a
// quem escreveu um número que o formulário devia ter recusado.
const MIN_MONTHS = 1;
const MAX_MONTHS = 60;

export const GET = withRoute({ permission: 'lifecycle:read', tenant: 'required' }, async ({ tenantId }) => {
  const inactiveMonths = await inactiveAfterMonths(tenantId);
  return Response.json({
    inactiveMonths,
    defaultMonths: DEFAULT_INACTIVE_MONTHS,
    min: MIN_MONTHS,
    max: MAX_MONTHS,
    // As descrições das etapas já com o limiar desta clínica lá dentro, para o ecrã não
    // dizer «mais de 6 meses» a uma clínica que escolheu três.
    stages: lifecycleStages(inactiveMonths),
  });
});

export const PUT = withRoute(
  { permission: 'lifecycle:configure', tenant: 'required' },
  async ({ request, user, tenantId }) => {
    const body = await request.json().catch(() => null);
    if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });

    const meses = Number(body.inactiveMonths);
    if (!Number.isInteger(meses) || meses < MIN_MONTHS || meses > MAX_MONTHS) {
      return Response.json(
        { error: `inactiveMonths tem de ser um inteiro entre ${MIN_MONTHS} e ${MAX_MONTHS}` },
        { status: 400 },
      );
    }

    const anterior = await inactiveAfterMonths(tenantId);
    await query(`UPDATE tenants SET inactive_after_months=$1 WHERE id=$2`, [meses, tenantId]);
    await appendAudit(user, 'UPDATE', 'Limiar de inatividade', `${anterior} meses`, `${meses} meses`, user.clinic);

    return Response.json({ inactiveMonths: meses, stages: lifecycleStages(meses) });
  },
);
