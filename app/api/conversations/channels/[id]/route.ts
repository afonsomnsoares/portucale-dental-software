import crypto from 'node:crypto';
import { appendAudit } from '@/lib/audit';
import { query, queryOne } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http';
import { hashChannelSecret } from '@/lib/inbound';
import { withRoute } from '@/lib/route';
import { sanitizeString } from '@/lib/validate';

// Rodar o segredo e desligar o canal. Ver o cabeçalho de ../route.ts para o porquê
// desta família de rotas existir.
const OPTIONS = { permission: 'conversations:configure' } as const;

// A conta, confinada à clínica de quem chama. O `tenant_id=$2` não é redundante com a
// RLS: sem ele, o id de outra clínica daria 404 por causa da política em vez de por
// decisão desta rota — certo por acidente, e a distinção deixa de existir para o
// super-admin, cujo contexto de RLS não o barra. Mesmo raciocínio de lib/tenantGuard.ts.
async function ownedChannel(id: string, tenantId: string) {
  return queryOne(`SELECT id, channel, address, auth_scheme FROM channel_accounts WHERE id=$1 AND tenant_id=$2`, [
    id,
    tenantId,
  ]);
}

export const PATCH = withRoute<{ id: string }>(OPTIONS, async ({ request, user, params, tenantId }) => {
  const { id } = params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Corpo inválido');

  const account = await ownedChannel(id, tenantId);
  if (!account) return notFound('Canal não encontrado');

  // ─── Rodar o segredo ──────────────────────────────────────────────────────
  // Só faz sentido no esquema 'shared_secret': o 'twilio' não tem segredo próprio —
  // valida contra o TWILIO_AUTH_TOKEN do ambiente. Dizer que rodou um segredo que não
  // existe seria mentir num sítio onde a pessoa vai confiar na resposta.
  if (body.rotateSecret === true) {
    if (String(account.auth_scheme) !== 'shared_secret') {
      return badRequest('Este canal valida a assinatura da Twilio e não tem segredo próprio para rodar.');
    }
    const secret = crypto.randomBytes(32).toString('base64url');
    await query(`UPDATE channel_accounts SET secret_hash=$1, updated_at=NOW() WHERE id=$2`, [
      hashChannelSecret(secret),
      id,
    ]);
    await appendAudit(
      user,
      'UPDATE',
      `Canal de entrada ${account.channel} ${account.address}: segredo rodado`,
      null,
      'rotated',
      user.clinic,
    );
    return Response.json({
      secret,
      aviso: 'Guarde este segredo agora — não volta a ser mostrado. O anterior deixou de ser aceite.',
    });
  }

  // ─── Ligar/desligar e renomear ────────────────────────────────────────────
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.active !== undefined) {
    vals.push(!!body.active);
    updates.push(`active=$${vals.length}`);
  }
  if (body.displayName !== undefined) {
    vals.push(sanitizeString(body.displayName, 120));
    updates.push(`display_name=$${vals.length}`);
  }
  if (!updates.length) return badRequest('Nada para alterar.');

  vals.push(id);
  const [row] = await query(
    `UPDATE channel_accounts SET ${updates.join(', ')}, updated_at=NOW()
      WHERE id=$${vals.length}
      RETURNING id, channel, address, display_name, active, auth_scheme`,
    vals,
  );
  await appendAudit(
    user,
    'UPDATE',
    `Canal de entrada ${account.channel} ${account.address}`,
    null,
    row?.active === false ? 'disabled' : 'updated',
    user.clinic,
  );
  return Response.json({ channel: row });
});

// ─── Desativar, não apagar ──────────────────────────────────────────────────
// As conversas que entraram por este canal continuam a apontar para a clínica, e o
// registo de auditoria fala dele pelo número. Apagar a linha tiraria o contexto a
// mensagens de doentes que ficam; `active=FALSE` fecha a porta, que é o que se pede a
// um DELETE aqui — e liberta o número no índice único para ser reassociado.
export const DELETE = withRoute<{ id: string }>(OPTIONS, async ({ user, params, tenantId }) => {
  const { id } = params;
  const account = await ownedChannel(id, tenantId);
  if (!account) return notFound('Canal não encontrado');

  await query(`UPDATE channel_accounts SET active=FALSE, updated_at=NOW() WHERE id=$1`, [id]);
  await appendAudit(
    user,
    'DELETE',
    `Canal de entrada ${account.channel} ${account.address}`,
    null,
    'disabled',
    user.clinic,
  );
  return Response.json({ ok: true });
});
