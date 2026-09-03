import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { erasePatient, exportPatientData } from '@/lib/dataSubject';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { deleteStoredFiles } from '@/lib/uploads';

// Cumprimento efetivo de um pedido do titular. Separado do PUT em ../route.ts de
// propósito: mudar o estado é um registo administrativo, isto executa trabalho
// irreversível sobre dados clínicos, e as duas coisas não devem partilhar
// caminho nem ser possíveis por engano.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'gdpr:manage'))) return forbidden();
  if (!user.tenantId) return forbidden();
  const { id } = await params;

  const req = await queryOne(`SELECT * FROM data_subject_requests WHERE id=$1 AND tenant_id=$2`, [id, user.tenantId]);
  if (!req) return notFound('Request not found');
  if (req.status === 'completed') return badRequest('Request already completed');
  if (!req.patient_id) return badRequest('Request has no patient attached');

  const finish = async (detail: string) => {
    await query(
      `UPDATE data_subject_requests
       SET status='completed', resolved_at=NOW(), resolved_by=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3`,
      [user.id, id, user.tenantId],
    );
    await appendAudit(user, 'UPDATE', `RGPD ${req.request_type} cumprido`, req.status, detail, user.clinic);
  };

  // ── Acesso e portabilidade (art. 15.º e 20.º) ────────────────────────────
  // O mesmo conteúdo serve os dois: o art. 20.º acrescenta a exigência de
  // formato estruturado e legível por máquina, que o JSON cumpre.
  if (req.request_type === 'access' || req.request_type === 'portability') {
    const data = await exportPatientData(user.tenantId, req.patient_id);
    if (!data) return notFound('Patient not found');

    await appendTimeline(req.patient_id, user, 'admin', `Dados exportados a pedido do titular (${req.request_type})`);
    await finish('exported');

    // Entregue como ficheiro: o titular tem direito a recebê-los, não a vê-los
    // numa consola de programador.
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="dados-paciente-${req.patient_id}.json"`,
      },
    });
  }

  // ── Apagamento (art. 17.º) ───────────────────────────────────────────────
  if (req.request_type === 'erasure') {
    // Irreversível. Exigir confirmação explícita no corpo evita que um clique
    // errado numa lista destrua a identidade de um paciente.
    const body = await request.json().catch(() => null);
    if (!body || body.confirm !== true) {
      return badRequest('Erasure is irreversible — send { "confirm": true } to proceed');
    }

    const result = await erasePatient(user.tenantId, req.patient_id);
    if (!result) return notFound('Patient not found');

    // As linhas de `uploads` já desapareceram; os ficheiros ainda não. Sem este
    // passo a clínica teria apagado o registo e mantido os documentos.
    const files = await deleteStoredFiles(result.storageKeys);

    // O timeline é append-only e sobrevive ao apagamento de propósito: é a prova
    // de que o pedido foi cumprido, e já não identifica ninguém.
    await appendTimeline(req.patient_id, user, 'admin', 'Dados pessoais apagados a pedido do titular (art. 17.º)');
    await finish('erased');

    return Response.json({
      ok: true,
      anonymized: result.anonymized,
      deleted: result.deleted,
      files,
    });
  }

  // ── Retificação, limitação e oposição (art. 16.º, 18.º e 21.º) ───────────
  // Não são automatizáveis: retificar é editar o que o titular indicar, limitar
  // e opor-se são decisões sobre finalidades de tratamento. A rota diz isso em
  // vez de fingir que fez alguma coisa.
  return badRequest(
    `'${req.request_type}' requer intervenção humana — trate o pedido e marque o estado em PUT /api/data-subject-requests/${id}`,
  );
}
