import { computePatientScore, computeTenantScores } from '@/lib/patientScoring';
import { withRoute } from '@/lib/route';

// Os três scorings do doente: envolvimento, risco de abandono e probabilidade de
// marcação. Só leitura, e nada é persistido — ver o cabeçalho de lib/patientScoring.ts.
//
// Vai à boleia de 'lifecycle:read' de propósito: isto é a versão contínua da mesma
// pergunta que o ciclo de vida responde por etapas ('novo / em tratamento / estável /
// desaparecido'). Duas permissões para a mesma coisa dariam uma clínica em que alguém
// vê o estágio e não vê o número que o explica.
export const GET = withRoute({ permission: 'lifecycle:read' }, async ({ request, tenantId }) => {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');
  if (patientId) {
    const scored = await computePatientScore(tenantId, patientId);
    return scored ? Response.json(scored) : Response.json({ error: 'Doente não encontrado' }, { status: 404 });
  }
  const limitRaw = Number(searchParams.get('limit') || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
  const patients = await computeTenantScores(tenantId, limit);
  return Response.json({ patients, count: patients.length });
});
