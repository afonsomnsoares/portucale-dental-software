import { computeDynamicPlan, runDynamicScheduling } from '@/lib/dynamicScheduling';
import { withRoute } from '@/lib/route';

// O Dynamic Scheduling visto de fora. Duas operações, deliberadamente separadas
// por permissões diferentes:
//
//   GET  — o plano. Não contacta ninguém, não escreve nada. É o que a página
//          mostra: "estes são os espaços vazios e quem devia estar neles".
//   POST — executa. Envia SMS reais a doentes reais, e por isso exige
//          'scheduling-agent:manage' e não a permissão de ler a agenda.
//
// O POST é o mesmo trabalho que o cron faz sozinho (job 'dynamicScheduling' em
// lib/jobsRunner.ts) — existe para quem quer ver o efeito agora, não para haver
// dois caminhos com regras diferentes: a política manda igualmente nos dois.
export const GET = withRoute({ permission: 'schedule:read', tenant: 'resolved' }, async ({ tenantId }) => {
  if (!tenantId) return Response.json({ error: 'tenantId é obrigatório' }, { status: 400 });
  return Response.json(await computeDynamicPlan(tenantId));
});

export const POST = withRoute(
  { permission: 'scheduling-agent:manage', tenant: 'resolved' },
  async ({ user, tenantId }) => {
    if (!tenantId) return Response.json({ error: 'tenantId é obrigatório' }, { status: 400 });
    return Response.json(await runDynamicScheduling(tenantId, user));
  },
);
