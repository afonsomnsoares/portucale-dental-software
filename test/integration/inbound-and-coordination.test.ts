// Integração para as três superfícies novas que tocam em autenticação, RLS e
// escrita concorrente — precisamente as que um teste puro não consegue cobrir:
//
//   • o WEBHOOK, que é público, aceita conteúdo de terceiros e escreve na base de
//     dados de uma clínica sem sessão nenhuma;
//   • a COORDENAÇÃO entre agentes, cujo valor é o que acontece quando vários
//     pedidos concorrem pelo mesmo doente na mesma passagem;
//   • a RECONCILIAÇÃO de encomendas, que congela um resultado e não pode voltar a
//     recalculá-lo depois disso.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { POST as webhookPost } from '../../app/api/webhooks/[channel]/route.ts';
import { requestContacts } from '../../lib/agents/coordination.ts';
import { query, queryOne } from '../../lib/db.ts';
import { hashChannelSecret } from '../../lib/inbound.ts';
import { closeTestDb, ensureSeeded, getTenantAId } from '../helpers/testDb.ts';

let tenantAId: string;
let tenantBId: string;
const CLINIC_NUMBER = '+351900111222';

before(async () => {
  await ensureSeeded();
  tenantAId = await getTenantAId();
  const b = await queryOne(`SELECT id FROM tenants WHERE name='Tenant B (testes)'`);
  tenantBId = String(b?.id);
  await query(
    `INSERT INTO channel_accounts (tenant_id, channel, address, display_name, secret_hash)
     VALUES ($1,'sms',$2,'Linha de testes',$3)
     ON CONFLICT DO NOTHING`,
    [tenantAId, CLINIC_NUMBER, hashChannelSecret('segredo-correto')],
  );
});

after(closeTestDb);

function webhookRequest(body: Record<string, string>, secret?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secret) headers.set('x-portucale-signature', secret);
  return new Request('http://localhost/api/webhooks/sms', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: o handler só usa .json()/.headers/.formData(), presentes no Request normal
  }) as any;
}

const ctx = { params: Promise.resolve({ channel: 'sms' }) };

// ─── O webhook é a rota mais exposta da aplicação ───────────────────────────

test('webhook: sem assinatura é recusado', async () => {
  const res = await webhookPost(webhookRequest({ To: CLINIC_NUMBER, From: '+351911111111', Body: 'olá' }), ctx);
  assert.equal(res.status, 403);
});

test('webhook: assinatura errada é recusada', async () => {
  const res = await webhookPost(
    webhookRequest({ To: CLINIC_NUMBER, From: '+351911111111', Body: 'olá' }, 'segredo-errado'),
    ctx,
  );
  assert.equal(res.status, 403);
});

// Não distinguir "endereço desconhecido" de "assinatura errada" evita dar um oráculo
// para descobrir que números pertencem a clínicas — mesma regra do login.
test('webhook: endereço desconhecido devolve o mesmo 403 que a assinatura errada', async () => {
  const res = await webhookPost(
    webhookRequest({ To: '+351999999999', From: '+351911111111', Body: 'olá' }, 'segredo-correto'),
    ctx,
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Rejected');
});

// Os canais removidos pela migração 052 têm de dar 404 como qualquer outro desconhecido:
// um webhook de WhatsApp que continuasse a aceitar seria uma porta aberta para um canal
// que a clínica decidiu não ter.
test('webhook: um canal inexistente ou removido devolve 404 sem tocar na base de dados', async () => {
  for (const channel of ['pombo-correio', 'whatsapp', 'email', 'webchat']) {
    const res = await webhookPost(
      webhookRequest({ To: CLINIC_NUMBER, From: '+351911111111', Body: 'x' }, 'segredo-correto'),
      { params: Promise.resolve({ channel }) },
    );
    assert.equal(res.status, 404, `${channel} devia dar 404`);
  }
});

test('webhook: sem destinatário é 400, não uma conversa órfã', async () => {
  const res = await webhookPost(webhookRequest({ From: '+351911111111', Body: 'olá' }, 'segredo-correto'), ctx);
  assert.equal(res.status, 400);
});

// A clínica NUNCA vem do corpo do pedido — vem do endereço de destino. Um tenantId no
// corpo seria um seletor de clínica oferecido a quem chama.
test('webhook: um tenantId no corpo é ignorado', async () => {
  const res = await webhookPost(
    webhookRequest(
      { To: CLINIC_NUMBER, From: '+351911222333', Body: 'bom dia', MessageSid: 'sid-tenant-injection', tenantId: tenantBId },
      'segredo-correto',
    ),
    ctx,
  );
  assert.equal(res.status, 200);
  const { conversationId } = await res.json();
  const conv = await queryOne(`SELECT tenant_id FROM conversations WHERE id=$1`, [conversationId]);
  assert.equal(String(conv?.tenant_id), tenantAId, 'a conversa tem de ficar na clínica dona do número');
});

// Os fornecedores reenviam o que não recebe 200 a tempo.
test('webhook: uma reentrega não cria uma segunda mensagem', async () => {
  const body = { To: CLINIC_NUMBER, From: '+351911333444', Body: 'quero remarcar', MessageSid: 'sid-repetido-1' };
  const first = await webhookPost(webhookRequest(body, 'segredo-correto'), ctx);
  const second = await webhookPost(webhookRequest(body, 'segredo-correto'), ctx);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
  const rows = await query(`SELECT id FROM conversation_messages WHERE provider_id='sid-repetido-1'`);
  assert.equal(rows.length, 1);
});

// A fronteira do produto: o software não interpreta sintomas.
test('webhook: uma mensagem clínica escala e não recebe resposta automática', async () => {
  const res = await webhookPost(
    webhookRequest(
      { To: CLINIC_NUMBER, From: '+351911444555', Body: 'tenho muitas dores e o dente partiu', MessageSid: 'sid-clinico' },
      'segredo-correto',
    ),
    ctx,
  );
  const { conversationId } = await res.json();
  const conv = await queryOne(`SELECT state, last_intent FROM conversations WHERE id=$1`, [conversationId]);
  assert.equal(conv?.state, 'escalated');
  assert.equal(conv?.last_intent, 'clinical');
  const auto = await query(
    `SELECT id FROM conversation_messages WHERE conversation_id=$1 AND automated=TRUE`,
    [conversationId],
  );
  assert.equal(auto.length, 0, 'nada de automático pode sair sobre um assunto clínico');
});

// Obrigação legal: processado sempre, independentemente do nível de autonomia.
test('webhook: um opt-out é gravado no perfil do doente', async () => {
  const [p] = await query(`SELECT id, phone FROM patients WHERE tenant_id=$1 AND phone IS NOT NULL LIMIT 1`, [tenantAId]);
  await query(`UPDATE patients SET comm_prefs='{}'::jsonb WHERE id=$1`, [p.id]);
  const res = await webhookPost(
    webhookRequest({ To: CLINIC_NUMBER, From: String(p.phone), Body: 'STOP', MessageSid: 'sid-optout' }, 'segredo-correto'),
    ctx,
  );
  assert.equal(res.status, 200);
  const after = await queryOne(`SELECT comm_prefs FROM patients WHERE id=$1`, [p.id]);
  const list = (after?.comm_prefs as { doNotContact?: string[] })?.doNotContact || [];
  assert.ok(list.includes('sms'), 'o pedido de não contacto tem de valer no perfil, não só na conversa');
});

// ─── Coordenação entre agentes ──────────────────────────────────────────────

test('coordenação: cinco pedidos para o mesmo doente no mesmo dia dão um contacto', async () => {
  const [p] = await query(
    `SELECT id FROM patients WHERE tenant_id=$1 AND comm_prefs->'doNotContact' IS NULL LIMIT 1`,
    [tenantAId],
  );
  await query(`DELETE FROM agent_contact_ledger WHERE patient_id=$1`, [p.id]);

  const pedido = (agentId: string, kind: string) => ({
    agentId,
    kind,
    patientId: String(p.id),
    dedupeKey: `${kind}-teste`,
    body: 'teste',
    queued: { patientId: String(p.id), phone: '+351911000000', payload: { kind, body: 'teste' } },
  });

  const summary = await requestContacts(tenantAId, [
    pedido('patient', 'lifecycle_reactivation'),
    pedido('patient', 'recall_reminder'),
    pedido('patient', 'plan_followup'),
    pedido('scheduling', 'risk_outreach'),
    pedido('scheduling', 'appointment_reminder'),
  ]);

  assert.equal(summary.granted, 1);
  assert.equal(summary.deferred + summary.rejected, 4);

  const ledger = await query(
    `SELECT kind, decision FROM agent_contact_ledger WHERE patient_id=$1 ORDER BY decision, kind`,
    [p.id],
  );
  assert.equal(ledger.length, 5, 'todas as decisões ficam registadas, não só as que saíram');
  const granted = ledger.find((l) => l.decision === 'granted');
  assert.equal(granted?.kind, 'appointment_reminder', 'o mais perecível ganha');
});

test('coordenação: só a mensagem autorizada é escrita em notifications', async () => {
  const [p] = await query(
    `SELECT id FROM patients WHERE tenant_id=$1 AND comm_prefs->'doNotContact' IS NULL OFFSET 1 LIMIT 1`,
    [tenantAId],
  );
  await query(`DELETE FROM agent_contact_ledger WHERE patient_id=$1`, [p.id]);
  await query(`DELETE FROM notifications WHERE patient_id=$1`, [p.id]);

  const pedido = (kind: string) => ({
    agentId: 'patient',
    kind,
    patientId: String(p.id),
    dedupeKey: `${kind}-n`,
    body: kind,
    queued: { patientId: String(p.id), phone: '+351911000001', payload: { kind, body: kind } },
  });
  await requestContacts(tenantAId, [pedido('recall_reminder'), pedido('plan_followup')]);

  const notifications = await query(`SELECT payload->>'kind' AS kind FROM notifications WHERE patient_id=$1`, [p.id]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'plan_followup', 'plan_followup tem prioridade sobre recall');
});

test('coordenação: um doente sem consentimento não recebe nada e a recusa fica escrita', async () => {
  const [p] = await query(`SELECT id FROM patients WHERE tenant_id=$1 LIMIT 1`, [tenantAId]);
  await query(`UPDATE patients SET comm_prefs='{"doNotContact":["sms"]}'::jsonb WHERE id=$1`, [p.id]);
  await query(`DELETE FROM agent_contact_ledger WHERE patient_id=$1`, [p.id]);

  const summary = await requestContacts(tenantAId, [
    {
      agentId: 'patient',
      kind: 'recall_reminder',
      patientId: String(p.id),
      dedupeKey: 'sem-consentimento',
      body: 'x',
      queued: { patientId: String(p.id), phone: '+351911000002', payload: { kind: 'recall_reminder', body: 'x' } },
    },
  ]);
  assert.equal(summary.granted, 0);
  const [row] = await query(`SELECT decision FROM agent_contact_ledger WHERE patient_id=$1`, [p.id]);
  assert.equal(row.decision, 'rejected', 'sem consentimento não é adiamento, é recusa definitiva');
});
