import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { badRequest, conflict, notFound, ok } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { sendSms } from '@/lib/sms';
import { toE164 } from '@/lib/validate';

// A única porta pela qual o rascunho do agente Lead (lib/agents/leadAgent.ts) sai da
// clínica — o agente escreve ai_draft_reply e para aí, nunca chama isto sozinho. Uma
// permissão dedicada ('leads:respond', distinta de 'patients:create' que já cobre
// registar/editar o lead) porque isto é contacto real com alguém de fora, não gestão
// interna de dados — ver a conversa que decidiu este desenho.
//
// Canal 'sms' só: este projeto ainda não sabe enviar email a ninguém (ver lib/sms.ts, o
// único canal automático que existe é Twilio). Um lead que só deixou email fica com o
// rascunho pronto mas sem botão de envio automático — limitação de âmbito, não de
// desenho, até existir esse canal.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'leads:respond'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  // Uma pessoa pode editar o rascunho antes de enviar — nunca é obrigada a mandar
  // exatamente o que a IA escreveu.
  const overrideText = typeof body.text === 'string' ? body.text.trim().slice(0, 600) : '';

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM leads WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [
      id,
      user.tenantId,
    ]);
    const lead = rows[0];
    if (!lead) return { error: 'not_found' as const };
    if (lead.ai_reply_sent_at) return { error: 'already_sent' as const };
    if (lead.ai_draft_channel !== 'sms') {
      return { error: lead.ai_draft_channel === 'email' ? 'email_not_supported' : 'not_triaged' } as const;
    }
    const text = overrideText || String(lead.ai_draft_reply || '');
    if (!text) return { error: 'not_triaged' as const };
    const phone = toE164(lead.phone);
    if (!phone) return { error: 'invalid_phone' as const };

    const sms = await sendSms({ to: phone, body: text });
    if (!sms.ok) return { error: 'send_failed' as const, detail: sms.error };

    const { rows: updated } = await client.query(
      `UPDATE leads SET ai_reply_sent_at=NOW(), ai_draft_reply=$1 WHERE id=$2 RETURNING *`,
      [text, id],
    );
    return { lead: updated[0] };
  });

  if (result.error === 'not_found') return notFound('Lead not found');
  if (result.error === 'already_sent') return conflict('A resposta a este lead já foi enviada');
  if (result.error === 'not_triaged') return badRequest('Este lead ainda não tem um rascunho do agente Lead');
  if (result.error === 'email_not_supported') {
    return badRequest('Este lead só deixou email — o envio automático ainda só existe por SMS');
  }
  if (result.error === 'invalid_phone') return badRequest('Número de telefone inválido para envio');
  if (result.error === 'send_failed') {
    // Mesmo padrão do resto do projeto: o detalhe do provedor fica só no log do
    // servidor, nunca na resposta ao cliente.
    console.error(`leads/${id}/send-reply: SMS send failed:`, result.detail);
    return badRequest('Falha ao enviar a mensagem. Tenta novamente dentro de momentos.');
  }

  await appendAudit(user, 'UPDATE', `Lead — resposta enviada: ${result.lead.name}`, null, 'sent', user.clinic);
  return ok(result.lead);
}
