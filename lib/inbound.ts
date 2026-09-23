import crypto from 'node:crypto';
import {
  cancelForPatient,
  hasPendingOffer,
  offerSlotToPatient,
  pendingOfferFor,
  pendingWaitlistOfferCount,
  recordOfferAccepted,
  upcomingAppointments,
} from './agents/schedulingAutonomy';
import { formatDatePT } from './constants';
import {
  type AutonomyLevel,
  buildEscalationBrief,
  type ConversationChannel,
  type ConversationState,
  canTransition,
  DEFAULT_AUTONOMY,
  type Intent,
  isAutonomyLevel,
  isStale,
  routeInbound,
  stateAfterInbound,
  writesToSchedule,
} from './conversationCalc';
import { query, queryOne, queryRead, withSystemContext } from './db';
import { createTask } from './patientTasks';
import { sendSms } from './sms';
import { verifyTwilioSignature } from './twilioSignature';
import { toE164 } from './validate';
import { acceptOfferAndBook } from './waitlist';

// Liga lib/conversationCalc.ts (a decisão, pura e testada) às tabelas da migração 049.
//
// ─── Onde é que este ficheiro é a superfície de ataque ──────────────────────
// Um webhook é um endpoint público que aceita conteúdo de terceiros e escreve na base
// de dados de uma clínica. É o sítio mais exposto de toda a aplicação, e por isso três
// coisas acontecem antes de qualquer escrita:
//
//   1. a assinatura é verificada contra o segredo da conta de canal, em tempo
//      constante — sem isto, qualquer pessoa que descubra o URL injeta mensagens
//      "do doente" e, com autonomia ligada, faz a clínica responder-lhes;
//   2. a clínica é resolvida a partir do DESTINATÁRIO (o número da clínica), nunca de
//      um parâmetro do pedido — um tenant_id vindo do corpo seria um seletor de
//      clínica oferecido a quem chama;
//   3. a mensagem é deduplicada pelo id do fornecedor, porque os fornecedores de SMS e
//      de voz reenviam quando não recebem 200 a tempo.
//
// Dois canais só: SMS e chamada. Ver o cabeçalho de lib/conversationCalc.ts para o
// porquê, e para a regra de que uma chamada nunca recebe resposta automática.

export interface InboundMessage {
  channel: ConversationChannel;
  // Endereço da CLÍNICA (o número/e-mail que recebeu). É a chave de resolução.
  toAddress: string;
  // Endereço do doente.
  fromAddress: string;
  fromName?: string | null;
  body: string;
  providerId?: string | null;
}

// Comparação em tempo constante, como em lib/auth.ts para o CSRF. Uma comparação
// normal vaza o segredo byte a byte para quem consiga medir o tempo de resposta.
function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function hashChannelSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * O que o webhook apresenta para provar que é quem diz ser. Qual destes campos conta
 * depende do `auth_scheme` da conta — ver resolveChannelAccount abaixo.
 */
export interface ChannelProof {
  /** X-Portucale-Signature: o segredo estático, para o esquema 'shared_secret'. */
  sharedSecret: string | null;
  /** X-Twilio-Signature: o HMAC do pedido, para o esquema 'twilio'. */
  twilioSignature: string | null;
  /** O URL que a Twilio assinou (ver twilioRequestUrl) e os campos do corpo. */
  requestUrl: string;
  params: Record<string, unknown>;
}

/**
 * Resolve a clínica a partir do endereço de destino e verifica a assinatura.
 *
 * withSystemContext porque isto corre ANTES de existir clínica — é precisamente o que
 * se está a descobrir. É a mesma exceção que o login e a revalidação de sessão já usam
 * (ver lib/db.ts), e pelo mesmo motivo: a tabela tem de ser lida sem um tenant
 * estabelecido, porque o tenant é a resposta e não a pergunta.
 *
 * ─── Dois esquemas, escolhidos pela conta e não pelo cabeçalho ──────────────
 * Ver scripts/migrations/065_channel_auth_scheme.sql. O que aqui estava aceitava o
 * cabeçalho que viesse e comparava-o sempre da mesma maneira — o que fazia a
 * assinatura real da Twilio falhar sempre, porque ela muda a cada pedido. Deixar a
 * conta declarar o esquema é o que impede que um remetente escolha a verificação mais
 * fraca simplesmente mandando o cabeçalho dessa.
 */
export async function resolveChannelAccount(channel: string, toAddress: string, proof: ChannelProof) {
  const account = await withSystemContext(() =>
    queryOne(
      `SELECT id, tenant_id, secret_hash, COALESCE(auth_scheme, 'shared_secret') AS auth_scheme
         FROM channel_accounts
        WHERE channel=$1 AND lower(address)=lower($2) AND active=TRUE`,
      [channel, toAddress],
    ),
  );
  if (!account) return { ok: false as const, status: 404, error: 'Unknown channel address' };

  if (String(account.auth_scheme) === 'twilio') {
    // O auth token da conta Twilio, o mesmo que lib/sms.ts usa para enviar. Não está na
    // base de dados de propósito — ver o cabeçalho de lib/twilioSignature.ts.
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '');
    // Mesma regra do 'shared_secret' abaixo: sem com que verificar, recusa-se. Um canal
    // que aceita qualquer coisa é pior do que um canal que não existe.
    if (!authToken) return { ok: false as const, status: 403, error: 'TWILIO_AUTH_TOKEN not configured' };
    if (
      !proof.twilioSignature ||
      !verifyTwilioSignature({
        url: proof.requestUrl,
        params: proof.params,
        signature: proof.twilioSignature,
        authToken,
      })
    ) {
      return { ok: false as const, status: 403, error: 'Invalid Twilio signature' };
    }
    return { ok: true as const, tenantId: String(account.tenant_id), accountId: String(account.id) };
  }

  // Uma conta sem segredo configurado é recusada em vez de aceite: um webhook que
  // aceita qualquer coisa é pior do que um webhook que não existe, porque parece que
  // está protegido.
  if (!account.secret_hash) return { ok: false as const, status: 403, error: 'Channel has no secret configured' };
  if (!proof.sharedSecret || !safeEqual(hashChannelSecret(proof.sharedSecret), String(account.secret_hash))) {
    return { ok: false as const, status: 403, error: 'Invalid signature' };
  }
  return { ok: true as const, tenantId: String(account.tenant_id), accountId: String(account.id) };
}

export async function getAutonomy(
  tenantId: string,
): Promise<{ level: AutonomyLevel; settings: Record<string, unknown> }> {
  const row = await queryOne(`SELECT * FROM tenant_comms_settings WHERE tenant_id=$1`, [tenantId]);
  return {
    // Uma clínica que nunca abriu o ecrã fica com 'off'. Ver a nota da migração 049: a
    // decisão «a IA pode falar sozinha com um doente?» não é do código.
    level: isAutonomyLevel(row?.autonomy_level) ? row.autonomy_level : DEFAULT_AUTONOMY,
    settings: row || {},
  };
}

// Fora do horário nada automático sai — uma resposta automática às 3h da manhã diz ao
// doente que não falou com ninguém. A janela pode atravessar a meia-noite, por isso a
// comparação é diferente conforme isso.
function inQuietHours(settings: Record<string, unknown>, now = new Date()): boolean {
  const start = String(settings.quiet_hours_start || '21:00').slice(0, 5);
  const end = String(settings.quiet_hours_end || '08:00').slice(0, 5);
  const hhmm = now.toTimeString().slice(0, 5);
  return start > end ? hhmm >= start || hhmm < end : hhmm >= start && hhmm < end;
}

// Encontra o doente pelo número. Com dois canais que são ambos telefónicos, é sempre o
// número — o ramo do e-mail deixou de existir com o canal. Correspondência por telefone
// normalizado, exatamente como a conversão de lead em doente já faz, e com a mesma
// limitação assumida: um número partilhado por um casal resolve para o primeiro dos
// dois, e é por isso que o nome do contacto é guardado à parte na conversa.
async function findPatientByAddress(tenantId: string, address: string) {
  const e164 = toE164(address);
  if (!e164) return null;
  // Compara os últimos 9 dígitos: os números na base estão gravados com e sem
  // indicativo, e exigir igualdade exata faria o sistema não reconhecer metade dos
  // doentes que já tem.
  const tail = e164.replace(/\D/g, '').slice(-9);
  return queryOne(
    `SELECT id, name FROM patients
     WHERE tenant_id=$1 AND phone IS NOT NULL
       AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = $2
     LIMIT 1`,
    [tenantId, tail],
  );
}

export interface InboundResult {
  conversationId: string;
  messageId: string | null;
  intent: Intent;
  action: string;
  state: ConversationState;
  autoReplySent: boolean;
  duplicate: boolean;
}

export async function handleInbound(tenantId: string, msg: InboundMessage): Promise<InboundResult> {
  // Deduplicação antes de tudo: uma reentrega não pode criar uma segunda mensagem, uma
  // segunda tarefa e uma segunda resposta automática.
  if (msg.providerId) {
    const existing = await queryOne(
      `SELECT m.id, m.conversation_id, m.intent, c.state
       FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.tenant_id=$1 AND m.provider_id=$2`,
      [tenantId, msg.providerId],
    );
    if (existing) {
      return {
        conversationId: String(existing.conversation_id),
        messageId: String(existing.id),
        intent: (existing.intent as Intent) || 'other',
        action: 'duplicate',
        state: existing.state as ConversationState,
        autoReplySent: false,
        duplicate: true,
      };
    }
  }

  const [{ level, settings }, patient] = await Promise.all([
    getAutonomy(tenantId),
    findPatientByAddress(tenantId, msg.fromAddress),
  ]);

  // Conversa aberta para este contacto e canal, ou uma nova. O índice parcial da
  // migração 049 garante que nunca há duas abertas ao mesmo tempo.
  let conversation = await queryOne(
    `SELECT * FROM conversations
     WHERE tenant_id=$1 AND channel=$2 AND lower(contact_address)=lower($3)
       AND state IN ('awaiting_staff','awaiting_patient','escalated')`,
    [tenantId, msg.channel, msg.fromAddress],
  );
  if (!conversation) {
    [conversation] = await query(
      `INSERT INTO conversations (tenant_id, patient_id, channel, contact_address, contact_name, state)
       VALUES ($1,$2,$3,$4,$5,'awaiting_staff') RETURNING *`,
      [tenantId, patient?.id || null, msg.channel, msg.fromAddress, msg.fromName || patient?.name || ''],
    );
  } else if (!conversation.patient_id && patient?.id) {
    // Uma conversa que começou anónima e cujo dono se descobriu depois. Acontece quando
    // o doente é registado no meio da conversa.
    await query(`UPDATE conversations SET patient_id=$2 WHERE id=$1`, [conversation.id, patient.id]);
    conversation.patient_id = patient.id;
  }

  // O contexto de agenda só se lê quando o degrau o usa: nos outros, são duas consultas
  // à base de dados por cada SMS recebido para não mudar decisão nenhuma.
  let agenda: { upcomingAppointmentCount: number; confidence: 'high'; hasPendingOffer: boolean } | undefined;
  if (writesToSchedule(level) && patient?.id) {
    const [futuras, pendente] = await Promise.all([
      upcomingAppointments(tenantId, String(patient.id)),
      hasPendingOffer(tenantId, String(patient.id)),
    ]);
    // A confiança real vem da classificação, dentro de routeInbound; aqui vai 'high'
    // porque este objeto só transporta os factos da agenda. Ver canActOnSchedule.
    agenda = { upcomingAppointmentCount: futuras.length, confidence: 'high', hasPendingOffer: pendente };
  }

  // Em todos os degraus, e não só no que escreve: ver o parâmetro em routeInbound.
  const ofertasDaLista = patient?.id ? await pendingWaitlistOfferCount(tenantId, String(patient.id)) : 0;

  const decision = routeInbound(
    msg.body,
    level,
    msg.channel,
    conversation.state as ConversationState,
    agenda,
    ofertasDaLista,
  );

  const [inbound] = await query(
    `INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, intent, routing, provider_id)
     VALUES ($1,$2,'inbound',$3,$4,$5::jsonb,$6) RETURNING id`,
    [tenantId, conversation.id, msg.body, decision.intent, JSON.stringify(decision), msg.providerId || null],
  );

  let autoReplySent = false;
  let replyBody: string | null = null;

  if (decision.action === 'process_optout') {
    await processOptOut(tenantId, conversation, msg);
    replyBody = 'Registámos o seu pedido. Não voltará a receber mensagens automáticas desta clínica.';
  } else if (decision.action === 'cancel_appointment') {
    // A resposta é escrita DEPOIS de a consulta estar mesmo cancelada, e só se estiver.
    // Um «cancelámos a sua consulta» enviado sobre um cancelamento que falhou é pior do
    // que não responder: o doente deixa de aparecer a uma consulta que continua marcada.
    const r = await cancelForPatient(tenantId, String(patient?.id), 'pedido por SMS');
    if (r) {
      replyBody = `A sua consulta de ${formatDatePT(r.cancelled.date)} às ${r.cancelled.startTime} fica cancelada. Quando quiser remarcar, é só dizer.`;
    } else {
      // A agenda mudou entre a leitura e a escrita. Vai para uma pessoa em vez de o
      // doente ficar sem resposta nenhuma.
      await createTask(tenantId, null, {
        patientId: conversation.patient_id || null,
        type: 'generic',
        title: `Cancelamento por SMS — confirmar com ${msg.fromName || patient?.name || msg.fromAddress}`,
        notes: 'O doente pediu para cancelar, mas a consulta deixou de ser identificável sem ambiguidade.',
        autoAssign: true,
      });
      replyBody = 'Recebemos o seu pedido de cancelamento. Confirmamos consigo dentro de momentos.';
    }
  } else if (decision.action === 'offer_slot') {
    // Remarcar: o lugar oferecido substitui a única consulta futura do doente (o
    // decideInbound só chega aqui com exatamente uma — ver canActOnSchedule), com o tipo
    // e a duração dela. Antes a oferta era de uma «Consulta de Avaliação» genérica, e o
    // SIM criava uma segunda consulta ao lado da original.
    const [aRemarcar] =
      decision.intent === 'reschedule' ? await upcomingAppointments(tenantId, String(patient?.id)) : [];
    const oferta = await offerSlotToPatient(tenantId, String(patient?.id), {
      origin: 'inbound',
      conversationId: String(conversation.id),
      type: aRemarcar ? String(aRemarcar.type) : null,
      replacing: aRemarcar
        ? {
            id: String(aRemarcar.id),
            date: String(aRemarcar.appt_date).slice(0, 10),
            startTime: String(aRemarcar.start_time).slice(0, 5),
            duration: Number(aRemarcar.duration) || 30,
          }
        : null,
    });
    if (oferta) {
      // O corpo da oferta é a própria resposta: a mensagem que o doente recebe É a
      // proposta, e o SIM dele refere-se a ela.
      replyBody = oferta.body;
    } else {
      await createTask(tenantId, null, {
        patientId: conversation.patient_id || null,
        type: 'generic',
        title: `Pedido de marcação — sem vaga automática para ${msg.fromName || patient?.name || msg.fromAddress}`,
        notes: 'Não havia horário compatível nos próximos 21 dias, ou o doente já tinha uma oferta pendente.',
        autoAssign: true,
      });
      replyBody = 'Recebemos o seu pedido. Vamos ver a agenda e entramos em contacto com uma proposta.';
    }
  } else if (decision.action === 'accept_offer') {
    const pendente = await pendingOfferFor(tenantId, String(patient?.id));
    const marcada = pendente ? await acceptOfferAndBook(tenantId, String(pendente.id)) : null;
    if (marcada) {
      await recordOfferAccepted(tenantId, String(patient?.id), marcada.appointment, marcada.rescheduledFrom);
      const d = String(marcada.appointment.appt_date).slice(0, 10);
      const h = String(marcada.appointment.start_time).slice(0, 5);
      replyBody = marcada.rescheduledFrom
        ? `Consulta mudada de ${formatDatePT(marcada.rescheduledFrom.date)} às ${marcada.rescheduledFrom.startTime} para ${formatDatePT(d)} às ${h}. Até lá!`
        : `Consulta marcada para ${formatDatePT(d)} às ${h}. Até lá!`;
    } else {
      // acceptOfferAndBook devolve null quando o lugar foi ocupado entretanto — ver o
      // claimSlot lá dentro. É o caso que torna esta mensagem necessária.
      await createTask(tenantId, null, {
        patientId: conversation.patient_id || null,
        type: 'generic',
        title: `Aceitação de vaga falhada — ${msg.fromName || patient?.name || msg.fromAddress}`,
        notes: 'O doente aceitou o lugar oferecido, mas ele já não estava livre. É preciso propor outro.',
        autoAssign: true,
      });
      replyBody = 'Esse horário acabou de ser ocupado. Entramos em contacto com uma alternativa.';
    }
  } else if (decision.action === 'auto_reply') {
    replyBody = factualReply(decision.intent, settings);
  } else if (decision.action === 'auto_acknowledge') {
    replyBody = String(settings.acknowledgement || 'Recebemos a sua mensagem. Respondemos assim que possível.');
  }

  // A confirmação de um opt-out sai SEMPRE, mesmo em horário de silêncio: é a prova de
  // que o pedido foi processado, e negá-la por ser tarde seria transformar uma
  // obrigação legal numa questão de conveniência.
  //
  // As três ações do degrau 'agenda' saem pela mesma razão, que não é legal mas é do
  // mesmo tipo: quando chegam aqui, a agenda JÁ mudou. Guardar a confirmação para as 8h
  // deixaria o doente a achar que tem consulta quando a acabámos de cancelar, ou que não
  // tem quando a acabámos de marcar. O silêncio existe para não acordar ninguém com
  // outreach; isto é o recibo de uma coisa que ele próprio acabou de pedir.
  const ALWAYS_SEND = new Set(['process_optout', 'cancel_appointment', 'accept_offer', 'offer_slot']);
  const suppressedByQuietHours = !ALWAYS_SEND.has(decision.action) && replyBody !== null && inQuietHours(settings);

  if (replyBody && !suppressedByQuietHours) {
    autoReplySent = await sendAutoReply(tenantId, String(conversation.id), msg, replyBody, decision.intent);
  }

  if (decision.action === 'human_task' || decision.action === 'escalate' || decision.action === 'auto_acknowledge') {
    await createTask(tenantId, null, {
      patientId: conversation.patient_id || null,
      type: 'generic',
      title: decision.urgent
        ? `⚠ ${msg.fromName || patient?.name || msg.fromAddress} — mensagem urgente`
        : `Responder a ${msg.fromName || patient?.name || msg.fromAddress}`,
      notes: buildEscalationBrief({
        patientName: (patient?.name as string) || msg.fromName || null,
        channel: msg.channel,
        intent: decision.intent,
        messageCount: await countMessages(tenantId, String(conversation.id)),
        autoRepliesSent: await countAutoReplies(tenantId, String(conversation.id)),
        lastInboundText: msg.body,
      }),
      autoAssign: true,
    });
  }

  const nextState = decision.nextState;
  await query(
    `UPDATE conversations
     SET state=$2, last_intent=$3, last_message_at=NOW(),
         escalated_at = CASE WHEN $2='escalated' AND escalated_at IS NULL THEN NOW() ELSE escalated_at END,
         updated_at=NOW()
     WHERE id=$1`,
    [conversation.id, nextState, decision.intent],
  );

  return {
    conversationId: String(conversation.id),
    messageId: inbound ? String(inbound.id) : null,
    intent: decision.intent,
    action: decision.action,
    state: nextState,
    autoReplySent,
    duplicate: false,
  };
}

// A retirada de consentimento escreve mesmo no perfil — não basta registá-la na
// conversa. `comm_prefs.doNotContact` é o que lib/commPrefs.ts consulta antes de
// qualquer envio automático, e é por isso o único sítio onde um opt-out tem efeito.
// ─── O opt-out NÃO usa a resolução para um doente só ────────────────────────
// `findPatientByAddress` devolve o primeiro de quantos partilhem o número, e assume-o
// por escrito. Para atribuir uma CONVERSA isso é aceitável — o nome de quem escreveu
// fica guardado à parte, e uma pessoa lê a conversa e percebe com quem fala.
//
// Para um opt-out não é, e a diferença é de natureza, não de grau. Num consultório os
// números partilhados são a norma, não a exceção: um casal, um pai e os filhos, o fixo
// de casa. Com a resolução para um só, quem escreve STOP vê o pedido gravado na ficha
// de outra pessoa — continua a receber mensagens, e alguém que nunca pediu nada deixa
// de as receber. As duas metades estão erradas, e a primeira é uma queixa à CNPD.
//
// Por isso aqui a pergunta é outra: QUEM PODE estar por trás deste número. Todos os que
// o partilham são calados, e fica uma tarefa para uma pessoa confirmar quando há mais
// do que um. A assimetria decide o desenho — um opt-out a mais desfaz-se com um clique;
// um a menos é uma mensagem que não devia ter saído, e essa não se desfaz.
async function processOptOut(tenantId: string, conversation: Record<string, unknown>, msg: InboundMessage) {
  const e164 = toE164(msg.fromAddress);
  const tail = e164 ? e164.replace(/\D/g, '').slice(-9) : '';

  // A conversa pode estar ligada a um doente cujo telefone já não bate certo com o
  // número de onde a mensagem veio (número mudado na ficha, por exemplo). Esse conta
  // na mesma: foi a ele que atribuímos a conversa onde o pedido foi feito.
  const conversationPatientId = (conversation.patient_id as string | null) || null;

  const silenced = tail
    ? await query(
        `UPDATE patients
       SET comm_prefs = jsonb_set(
             COALESCE(comm_prefs, '{}'::jsonb),
             '{doNotContact}',
             (
               SELECT to_jsonb(ARRAY(SELECT DISTINCT unnest(
                 COALESCE(ARRAY(SELECT jsonb_array_elements_text(comm_prefs->'doNotContact')), ARRAY[]::text[])
                 || ARRAY['sms','phone']
               )))
             ),
             TRUE
           )
       WHERE tenant_id=$1
         AND (
           right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $2
           OR id = $3::uuid
         )
       RETURNING id, name`,
        [tenantId, tail, conversationPatientId],
      )
    : await query(
        `UPDATE patients
       SET comm_prefs = jsonb_set(
             COALESCE(comm_prefs, '{}'::jsonb),
             '{doNotContact}',
             (
               SELECT to_jsonb(ARRAY(SELECT DISTINCT unnest(
                 COALESCE(ARRAY(SELECT jsonb_array_elements_text(comm_prefs->'doNotContact')), ARRAY[]::text[])
                 || ARRAY['sms','phone']
               )))
             ),
             TRUE
           )
       WHERE tenant_id=$1 AND id = $2::uuid
       RETURNING id, name`,
        [tenantId, conversationPatientId],
      );

  // Nenhum doente reconhecido: o pedido vale na mesma e alguém tem de o ligar à ficha
  // certa. Um opt-out que se perde por não sabermos quem é o remetente continua a ser
  // um opt-out ignorado.
  if (!silenced.length) {
    await createTask(tenantId, null, {
      patientId: null,
      type: 'generic',
      title: `Pedido de não contacto de ${msg.fromAddress} — associar à ficha`,
      notes: `Recebido por ${msg.channel}: "${msg.body.slice(0, 200)}". Não foi possível identificar o doente pelo contacto.`,
      autoAssign: true,
    });
    return;
  }

  // Mais do que um: calados todos (ver o cabeçalho), e uma pessoa confirma quem pediu
  // mesmo. A tarefa nasce ligada ao doente da conversa quando há um, porque é o palpite
  // mais informado que temos sobre quem escreveu.
  if (silenced.length > 1) {
    const nomes = silenced.map((p) => String(p.name)).join(', ');
    await createTask(tenantId, null, {
      patientId: conversationPatientId,
      type: 'generic',
      title: `Não contactar pedido de ${msg.fromAddress} — ${silenced.length} doentes partilham o número`,
      notes:
        `Recebido por ${msg.channel}: "${msg.body.slice(0, 200)}". ` +
        `O pedido foi aplicado a todos por segurança: ${nomes}. ` +
        `Confirmar quem o fez e reativar o contacto dos restantes, se for o caso.`,
      autoAssign: true,
    });
  }
}

// Respostas de facto. O texto vem do que uma PESSOA escreveu nas definições — não é
// gerado. Um horário inventado por um modelo é uma promessa que a clínica vai ter de
// honrar.
function factualReply(intent: Intent, settings: Record<string, unknown>): string | null {
  if (intent === 'hours') return (settings.opening_hours as string) || null;
  if (intent === 'location') return (settings.address_text as string) || null;
  // 'confirm', 'cancel' e 'reschedule' no degrau 'transactional' produzem um aviso de
  // receção com compromisso, e não uma alteração de agenda: alterar a agenda sozinha é
  // um degrau que ainda não existe, e fingir que existe seria pior do que não o ter.
  if (intent === 'confirm') return 'Obrigado, a sua consulta fica confirmada. Até breve.';
  if (intent === 'cancel')
    return 'Recebemos o seu pedido de cancelamento e vamos tratar dele. Entramos em contacto para reagendar.';
  if (intent === 'reschedule') return 'Recebemos o seu pedido de remarcação. Entramos em contacto com alternativas.';
  return null;
}

async function sendAutoReply(
  tenantId: string,
  conversationId: string,
  msg: InboundMessage,
  body: string,
  intent: Intent,
) {
  // Só o SMS sai por aqui. Uma chamada nunca chega a este ponto — routeInbound devolve
  // sempre 'human_task' para voz (ver allowsAutoReply em lib/conversationCalc.ts) — mas a
  // guarda fica na mesma, porque uma função que envia mensagens não deve depender de
  // outra se lembrar de não a chamar.
  const phone = msg.channel === 'sms' ? toE164(msg.fromAddress) : '';
  let sent = false;
  if (phone) {
    const result = await sendSms({ to: phone, body });
    sent = result.ok;
  }
  await query(
    `INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, automated, intent)
     VALUES ($1,$2,'outbound',$3,TRUE,$4)`,
    [tenantId, conversationId, body, intent],
  );
  return sent;
}

async function countMessages(tenantId: string, conversationId: string) {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS c FROM conversation_messages WHERE tenant_id=$1 AND conversation_id=$2`,
    [tenantId, conversationId],
  );
  return Number(row?.c || 0);
}

async function countAutoReplies(tenantId: string, conversationId: string) {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS c FROM conversation_messages
     WHERE tenant_id=$1 AND conversation_id=$2 AND direction='outbound' AND automated=TRUE`,
    [tenantId, conversationId],
  );
  return Number(row?.c || 0);
}

// ─── A caixa de entrada ─────────────────────────────────────────────────────

export async function listConversations(tenantId: string, state?: string) {
  return queryRead(
    `SELECT c.*, p.name AS patient_name,
            (SELECT body FROM conversation_messages m
              WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT COUNT(*)::int FROM conversation_messages m WHERE m.conversation_id=c.id) AS message_count
     FROM conversations c
     LEFT JOIN patients p ON p.id = c.patient_id
     WHERE c.tenant_id=$1 AND ($2::text IS NULL OR c.state=$2)
     ORDER BY
       -- Escalados primeiro, depois o que espera por nós, depois o resto. Uma caixa de
       -- entrada ordenada por data mistura o que já respondemos com o que não —
       -- e uma caixa assim é uma caixa que ninguém consegue esvaziar.
       CASE c.state WHEN 'escalated' THEN 0 WHEN 'awaiting_staff' THEN 1 ELSE 2 END,
       c.last_message_at DESC
     LIMIT 200`,
    [tenantId, state || null],
  );
}

export async function getConversation(tenantId: string, id: string) {
  const [conversation, messages] = await Promise.all([
    queryOne(
      `SELECT c.*, p.name AS patient_name FROM conversations c
       LEFT JOIN patients p ON p.id = c.patient_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [id, tenantId],
    ),
    queryRead(
      `SELECT id, direction, body, automated, intent, sent_by, created_at
       FROM conversation_messages WHERE conversation_id=$1 AND tenant_id=$2 ORDER BY created_at`,
      [id, tenantId],
    ),
  ]);
  return conversation ? { conversation, messages } : null;
}

export type ReplyResult = { ok: true; message: Record<string, unknown> } | { ok: false; status: number; error: string };

// A resposta de uma pessoa. Ao contrário das automáticas, esta sai sempre — não passa
// por autonomia nem por horário de silêncio, porque quem carregou no botão é que sabe
// se é boa altura.
export async function replyToConversation(
  tenantId: string,
  conversationId: string,
  userId: string,
  body: string,
): Promise<ReplyResult> {
  const conversation = await queryOne(`SELECT * FROM conversations WHERE id=$1 AND tenant_id=$2`, [
    conversationId,
    tenantId,
  ]);
  if (!conversation) return { ok: false, status: 404, error: 'Conversa não encontrada' };
  if (conversation.state === 'closed') return { ok: false, status: 400, error: 'Conversa fechada' };

  // A resposta a uma conversa de VOZ é uma chamada, e uma chamada faz-se com o telefone
  // na mão — o sistema não a coloca. O que se grava é o registo do que ficou dito, para
  // o fio ficar completo e para a próxima pessoa saber o que já foi conversado.
  if (String(conversation.channel) === 'sms') {
    const phone = toE164(String(conversation.contact_address));
    if (phone) await sendSms({ to: phone, body });
  }

  const [message] = await query(
    `INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, sent_by, automated)
     VALUES ($1,$2,'outbound',$3,$4,FALSE) RETURNING *`,
    [tenantId, conversationId, body, userId],
  );
  await query(
    `UPDATE conversations SET state='awaiting_patient', last_message_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [conversationId],
  );
  return { ok: true, message };
}

export async function setConversationState(
  tenantId: string,
  conversationId: string,
  next: ConversationState,
): Promise<ReplyResult | { ok: true; conversation: Record<string, unknown> }> {
  const conversation = await queryOne(`SELECT state FROM conversations WHERE id=$1 AND tenant_id=$2`, [
    conversationId,
    tenantId,
  ]);
  if (!conversation) return { ok: false, status: 404, error: 'Conversa não encontrada' };
  const from = conversation.state as ConversationState;
  // A máquina de estados é validada no servidor, como a das consultas. Transições
  // inválidas dão 400 em vez de gravarem um estado que não faz sentido.
  if (!canTransition(from, next)) {
    return { ok: false, status: 400, error: `Transição inválida: ${from} → ${next}` };
  }
  const [row] = await query(
    `UPDATE conversations SET state=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [conversationId, tenantId, next],
  );
  return { ok: true, conversation: row };
}

// Uma conversa esquecida é pior do que uma não atendida: o doente já sabe que a
// mensagem chegou. Corrido pelo job 'conversationSweep'.
export async function sweepStaleConversations(tenantId: string) {
  const rows = await queryRead(
    `SELECT c.id, c.state, c.contact_address, c.contact_name, c.patient_id, c.last_message_at,
            EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 3600 AS hours_since
     FROM conversations c
     WHERE c.tenant_id=$1 AND c.state IN ('awaiting_staff','escalated')`,
    [tenantId],
  );

  let flagged = 0;
  for (const r of rows) {
    if (!isStale(r.state as ConversationState, Number(r.hours_since))) continue;
    const marker = `conversation-stale:${r.id}`;
    const exists = await queryOne(
      `SELECT 1 FROM patient_tasks WHERE tenant_id=$1 AND notes LIKE $2 AND completed_at IS NULL`,
      [tenantId, `${marker}%`],
    );
    if (exists) continue;
    await createTask(tenantId, null, {
      patientId: (r.patient_id as string) || null,
      type: 'generic',
      title: `Conversa sem resposta há ${Math.floor(Number(r.hours_since))}h — ${r.contact_name || r.contact_address}`,
      notes: `${marker} Estado: ${r.state}. O doente já sabe que a mensagem chegou.`,
      autoAssign: true,
    });
    flagged += 1;
  }
  return { scanned: rows.length, flagged };
}

export { stateAfterInbound };
