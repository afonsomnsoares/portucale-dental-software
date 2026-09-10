// Integration tests for lib/agents/leadAgent.ts e app/api/leads/[id]/send-reply — o
// agente Lead qualifica e escreve o rascunho, nunca envia sozinho; este endpoint é a
// única porta pela qual o rascunho sai da clínica. Run com:
//   node --import tsx --env-file=.env.test --test test/integration/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { triageOpenLeads } from '../../lib/agents/leadAgent.ts';
import { query } from '../../lib/db.ts';
import { POST as postLead } from '../../app/api/leads/route.ts';
import { POST as sendReply } from '../../app/api/leads/[id]/send-reply/route.ts';
import { authedRequest } from '../helpers/authedRequest.ts';
import { closeTestDb, ensureSeeded, getSeededUser, getTenantAId } from '../helpers/testDb.ts';
import type { TestUser } from '../helpers/authedRequest.ts';

let receptionistA: TestUser;
let dentistA: TestUser;
let tenantAId: string;

before(async () => {
  await ensureSeeded();
  receptionistA = await getSeededUser('rececao@portucale.dental');
  dentistA = await getSeededUser('medico@portucale.dental');
  tenantAId = await getTenantAId();
});

after(closeTestDb);

async function createLead(overrides: Record<string, unknown> = {}) {
  const res = await postLead(
    authedRequest(receptionistA, {
      method: 'POST',
      url: '/api/leads',
      body: { name: 'Lead do agente (teste)', phone: '912345678', ...overrides },
    }),
   { params: Promise.resolve({}) });
  assert.equal(res.status, 201);
  return res.json();
}

test('sem ANTHROPIC_API_KEY, o agente Lead não triagem nada', async () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'este teste assume .env.test sem a chave');
  const lead = await createLead();

  const result = await triageOpenLeads(tenantAId);
  assert.deepEqual(result, { triaged: 0, configured: false });

  const [row] = await query(`SELECT ai_triaged_at FROM leads WHERE id=$1`, [lead.id]);
  assert.equal(row.ai_triaged_at, null);
});

test('enviar resposta a um lead ainda não triado é rejeitado com 400', async () => {
  const lead = await createLead();
  const res = await sendReply(
    authedRequest(receptionistA, { method: 'POST', url: `/api/leads/${lead.id}/send-reply`, body: {} }),
    { params: Promise.resolve({ id: lead.id }) },
  );
  assert.equal(res.status, 400);
});

test('dentista (sem leads:respond) recebe 403 ao tentar enviar', async () => {
  const lead = await createLead();
  const res = await sendReply(
    authedRequest(dentistA, { method: 'POST', url: `/api/leads/${lead.id}/send-reply`, body: {} }),
    { params: Promise.resolve({ id: lead.id }) },
  );
  assert.equal(res.status, 403);
});

test('lead já triado (rascunho SMS): sem Twilio configurado, falha de forma limpa em vez de rebentar', async () => {
  const lead = await createLead();
  await query(
    `UPDATE leads SET ai_qualification='hot', ai_draft_channel='sms', ai_draft_reply='Olá! Obrigado pelo contacto.', ai_triaged_at=NOW()
     WHERE id=$1`,
    [lead.id],
  );

  const res = await sendReply(
    authedRequest(receptionistA, { method: 'POST', url: `/api/leads/${lead.id}/send-reply`, body: {} }),
    { params: Promise.resolve({ id: lead.id }) },
  );
  // TWILIO_* não está definido em .env.test — o envio falha, mas com um erro genérico,
  // nunca uma excepção não tratada.
  assert.equal(res.status, 400);

  const [row] = await query(`SELECT ai_reply_sent_at FROM leads WHERE id=$1`, [lead.id]);
  assert.equal(row.ai_reply_sent_at, null, 'uma falha de envio não pode marcar como enviado');
});

// Com o agente reduzido a chamada e SMS (migração 052), um lead sem telefone deixa de ter
// rascunho: não há por onde o expedir. O ramo do e-mail existiu e nunca chegou a enviar
// nada — a rota devolvia 'email_not_supported' desde sempre.
test('lead sem telefone: a base recusa um rascunho de e-mail e o envio dá 400', async () => {
  const lead = await createLead({ phone: '', email: 'so-email@teste.pt' });

  await assert.rejects(
    () =>
      query(
        `UPDATE leads SET ai_qualification='warm', ai_draft_channel='email', ai_draft_reply='Olá!', ai_triaged_at=NOW()
         WHERE id=$1`,
        [lead.id],
      ),
    'o CHECK de leads_ai_draft_channel_check já não aceita e-mail',
  );

  const res = await sendReply(
    authedRequest(receptionistA, { method: 'POST', url: `/api/leads/${lead.id}/send-reply`, body: {} }),
    { params: Promise.resolve({ id: lead.id }) },
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /rascunho/i);
});
