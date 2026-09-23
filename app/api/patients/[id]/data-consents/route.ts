import { appendAudit, appendTimeline } from '@/lib/audit';
import { query } from '@/lib/db';
import { GROUP_TRANSFER_CONSENT } from '@/lib/group';
import { badRequest, notFound } from '@/lib/http';
import { REACTIVATION_CONSENT_TYPE } from '@/lib/lifecycleCalc';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { sanitizeString } from '@/lib/validate';

// ─── Os consentimentos que o resto do produto já pede ───────────────────────
// Três funcionalidades dependem de `patient_data_consents` — a reativação automática
// (lib/lifecycle.ts), as audiências de campanha e a transferência entre clínicas do grupo
// (lib/group.ts) — e nenhum código escrevia nessa tabela. As três ficavam vazias em
// produção, sem erro: um doente sem consentimento registado é, corretamente, um doente
// que não se contacta. Faltava o sítio onde a receção regista o que o doente disse.
//
// Só estes dois tipos, e não um texto livre: são as chaves que as consultas procuram à
// letra, e um tipo escrito de outra forma seria um consentimento que nada honra.
const CONSENT_TYPES: Record<string, string> = {
  [REACTIVATION_CONSENT_TYPE]: 'Contactos de reativação e campanhas por SMS',
  [GROUP_TRANSFER_CONSENT]: 'Propostas de vaga noutra unidade do grupo',
};

export const GET = withRoute<{ id: string }>(
  { authOnly: 'Os consentimentos de um doente da própria clínica, mostrados na ficha', tenant: 'optional' },
  async ({ params, tenantId }) => {
    const patient = await getOwnedPatient(params.id, { tenantId });
    if (!patient) return notFound('Patient not found');

    const ativos = await query(
      `SELECT consent_type, given_at FROM patient_data_consents
        WHERE patient_id=$1 AND tenant_id=$2 AND given = TRUE AND revoked_at IS NULL`,
      [patient.id, patient.tenant_id],
    );
    const porTipo = new Map(ativos.map((r) => [String(r.consent_type), r.given_at]));
    return Response.json(
      Object.entries(CONSENT_TYPES).map(([type, label]) => ({
        type,
        label,
        given: porTipo.has(type),
        givenAt: porTipo.get(type) ?? null,
      })),
    );
  },
);

// ─── Retirar não apaga ──────────────────────────────────────────────────────
// Um consentimento retirado fica com `revoked_at`, e um novo é uma linha nova. É o
// histórico que prova, mais tarde, que cada mensagem enviada tinha base legal no dia em
// que saiu — a mesma razão pela qual lib/dataSubject.ts conserva esta tabela num pedido
// de apagamento.
export const PUT = withRoute<{ id: string }>(
  { permission: 'patients:update', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const patient = await getOwnedPatient(params.id, { tenantId });
    if (!patient) return notFound('Patient not found');

    const body = await request.json().catch(() => null);
    const type = String(body?.type || '');
    const label = CONSENT_TYPES[type];
    if (!label) return badRequest('Tipo de consentimento desconhecido');
    if (typeof body?.given !== 'boolean') return badRequest('given tem de ser true ou false');

    if (body.given) {
      // Idempotente: com um consentimento ativo, um segundo «sim» não cria outra linha.
      await query(
        `INSERT INTO patient_data_consents (tenant_id, patient_id, consent_type, purpose, lawful_basis, given, created_by)
         SELECT $1,$2,$3,$4,'consent',TRUE,$5
          WHERE NOT EXISTS (
            SELECT 1 FROM patient_data_consents
             WHERE patient_id=$2 AND tenant_id=$1 AND consent_type=$3 AND given = TRUE AND revoked_at IS NULL
          )`,
        [tenantId, patient.id, type, label, user.id],
      );
    } else {
      await query(
        `UPDATE patient_data_consents SET revoked_at=NOW(), revoked_reason=$4
          WHERE patient_id=$1 AND tenant_id=$2 AND consent_type=$3 AND given = TRUE AND revoked_at IS NULL`,
        [patient.id, tenantId, type, sanitizeString(body.reason, 500) || 'Retirado a pedido do doente'],
      );
    }

    const acao = body.given ? 'registado' : 'retirado';
    await appendAudit(user, 'UPDATE', `Consentimento ${acao}: ${label}`, null, String(patient.id), user.clinic);
    await appendTimeline(String(patient.id), user, 'admin', `Consentimento ${acao}: ${label}.`);

    return Response.json({ type, label, given: body.given });
  },
);
