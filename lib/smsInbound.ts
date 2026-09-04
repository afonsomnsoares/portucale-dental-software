import { appendTimeline } from './audit';
import type { SessionUser } from './auth';
import { enterTenantContext, query, queryOne, withSystemContext } from './db';
import { logInteraction } from './patientInteractions';
import { createTask } from './patientTasks';
import {
  acceptOfferAndBook,
  type BookOfferError,
  declineOffer,
  latestPendingOfferForPatient,
  offerSlotTimes,
  recordOfferBooking,
} from './slotOffers';
import { parseSmsReply, type SmsIntent } from './smsReplyCalc';
import { toE164 } from './validate';
import { notifyWaitlistOfFreedSlot } from './waitlist';

// O outro lado do SMS.
//
// O produto pede "responda SIM" desde a primeira versão do risco de falta, mas
// até aqui não havia nada a ler as respostas: o doente respondia e a mensagem
// caía numa caixa do provedor que ninguém abria. Enquanto assim foi, nenhuma
// automação de agenda podia fechar o ciclo — dava para oferecer, não para
// confirmar.
//
// A regra que atravessa este ficheiro: o sistema só age sozinho quando a
// mensagem é inequívoca E a clínica autorizou (`slot_offers.auto_book`, gravado
// no momento em que a oferta saiu). Tudo o resto vira tarefa para uma pessoa —
// nunca se descarta uma resposta em silêncio, porque do outro lado está alguém
// que escreveu à clínica e espera resposta.

// O ator dos registos feitos por uma mensagem recebida. Não há sessão nenhuma
// aqui — segue a convenção do SYSTEM_ACTOR de lib/jobsRunner.ts.
const SMS_ACTOR: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = {
  id: '',
  name: 'Resposta SMS',
  role: 'system',
  clinic: 'System',
};

export interface InboundSms {
  from: string;
  body: string;
  providerId: string | null;
}

export interface InboundResult {
  status: 'duplicate' | 'unknown_number' | 'handled';
  intent: SmsIntent | null;
  outcome: string;
  tenantId: string | null;
  patientId: string | null;
  offerId: string | null;
  booked: boolean;
}

const BOOK_ERROR_TEXT: Record<BookOfferError, string> = {
  not_found: 'a oferta já não existe',
  not_pending: 'a oferta já tinha sido respondida',
  expired: 'a oferta já tinha expirado',
  slot_taken: 'o horário foi entretanto ocupado',
  no_patient: 'a ficha do doente já não existe',
};

/**
 * Descobre a que doente (e a que clínica) pertence um número.
 *
 * Corre em withSystemContext porque é o único ponto do produto onde a clínica
 * ainda não é conhecida: uma mensagem recebida não traz sessão, não traz cookie
 * e não traz tenant — o número de telemóvel é a única identidade que existe, e
 * procurá-lo obriga a atravessar clínicas precisamente porque não se sabe ainda
 * qual é. A janela é o mais estreita possível: assim que a clínica é conhecida,
 * o resto do processamento corre no contexto dela (ver enterTenantContext em
 * processInboundSms).
 *
 * Com o mesmo número em duas clínicas (acontece: famílias, um número de casa),
 * ganha quem tiver uma oferta pendente; sem isso, o doente visto mais
 * recentemente. Não se adivinha melhor do que isto, e é por isso que uma
 * resposta ambígua acaba sempre numa tarefa para uma pessoa.
 */
async function resolvePatientByPhone(phone: string) {
  const e164 = toE164(phone);
  if (!e164) return null;
  return withSystemContext(async () => {
    const rows = await query(
      `SELECT p.id, p.tenant_id, p.name, p.comm_prefs,
              (SELECT COUNT(*) FROM slot_offers o WHERE o.patient_id = p.id AND o.status='sent')::int AS pending_offers
         FROM patients p
        WHERE p.status <> 'anonymized'
          AND regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g') <> ''
          AND right(regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g'), 9) = right($1, 9)
        ORDER BY pending_offers DESC, p.created_at DESC
        LIMIT 1`,
      [e164.replace(/[^0-9]/g, '')],
    );
    return rows[0] || null;
  });
}

async function logInbound(row: {
  tenantId: string | null;
  patientId: string | null;
  offerId: string | null;
  from: string;
  body: string;
  intent: SmsIntent;
  outcome: string;
  providerId: string | null;
}) {
  const insert = () =>
    query(
      `INSERT INTO sms_inbound (tenant_id, patient_id, slot_offer_id, from_addr, body, intent, outcome, provider_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (provider_id) DO NOTHING`,
      [
        row.tenantId,
        row.patientId,
        row.offerId,
        row.from,
        row.body.slice(0, 2000),
        row.intent,
        row.outcome,
        row.providerId,
      ],
    );
  // Uma mensagem de um número que não é de nenhuma clínica não passa a RLS de
  // sms_inbound (tenant_id NULL só é visível ao super-admin) — mas continua a
  // ter de ser gravada, senão um erro de configuração do provedor fica invisível.
  if (row.tenantId) await insert();
  else await withSystemContext(insert);
}

export async function processInboundSms(msg: InboundSms): Promise<InboundResult> {
  const intent = parseSmsReply(msg.body);

  // Idempotência. O Twilio reentrega o mesmo webhook quando não recebe 200 a
  // tempo, e sem isto um timeout de rede marcava a mesma consulta duas vezes —
  // o tipo de erro que só se descobre com o doente à porta.
  if (msg.providerId) {
    const seen = await withSystemContext(() =>
      queryOne(`SELECT id, tenant_id, patient_id, slot_offer_id, outcome FROM sms_inbound WHERE provider_id=$1`, [
        msg.providerId,
      ]),
    );
    if (seen) {
      return {
        status: 'duplicate',
        intent,
        outcome: String(seen.outcome || ''),
        tenantId: (seen.tenant_id as string) || null,
        patientId: (seen.patient_id as string) || null,
        offerId: (seen.slot_offer_id as string) || null,
        booked: false,
      };
    }
  }

  const patient = await resolvePatientByPhone(msg.from);
  if (!patient) {
    const outcome = 'Número não corresponde a nenhum doente';
    await logInbound({
      tenantId: null,
      patientId: null,
      offerId: null,
      from: msg.from,
      body: msg.body,
      intent,
      outcome,
      providerId: msg.providerId,
    });
    return { status: 'unknown_number', intent, outcome, tenantId: null, patientId: null, offerId: null, booked: false };
  }

  const tenantId = String(patient.tenant_id);
  const patientId = String(patient.id);
  // A partir daqui já se sabe a clínica: tudo o que se segue corre confinado a
  // ela, como qualquer pedido autenticado.
  enterTenantContext({ tenantId, role: 'receptionist' });

  await logInteraction(tenantId, null, {
    patientId,
    channel: 'sms',
    direction: 'inbound',
    summary: msg.body.slice(0, 500),
  });

  const offer = await latestPendingOfferForPatient(tenantId, patientId);
  let outcome = '';
  let booked = false;

  if (intent === 'stop') {
    // Revogação de consentimento: primeiro cala-se o canal, depois liberta-se o
    // que estivesse pendente em nome dele — uma vaga reservada para quem já não
    // quer ser contactado é uma cadeira a ficar vazia.
    await query(
      `UPDATE patients
          SET comm_prefs = jsonb_set(
                COALESCE(comm_prefs, '{}'::jsonb), '{doNotContact}',
                COALESCE(comm_prefs->'doNotContact', '[]'::jsonb) || '["sms"]'::jsonb, true)
        WHERE id=$1 AND tenant_id=$2
          AND NOT COALESCE(comm_prefs->'doNotContact', '[]'::jsonb) @> '["sms"]'::jsonb`,
      [patientId, tenantId],
    );
    if (offer) await declineOffer(tenantId, String(offer.id));
    outcome = 'Doente pediu para não receber SMS — canal desativado';
    await appendTimeline(patientId, SMS_ACTOR, 'admin', `${outcome} (resposta: "${msg.body.slice(0, 80)}")`);
  } else if (!offer) {
    // Uma resposta sem oferta pendente é quase sempre resposta a um lembrete
    // ("SIM, confirmo a consulta de amanhã") — informação útil que não pode
    // desaparecer, mas que não corresponde a nenhuma decisão a tomar aqui.
    outcome = 'Resposta sem oferta pendente';
    await createTask(tenantId, null, {
      patientId,
      type: 'call',
      title: `Resposta por SMS de ${patient.name}: "${msg.body.slice(0, 60)}"`,
      notes: 'Mensagem recebida sem oferta de vaga pendente.',
      autoAssign: true,
    });
  } else if (intent === 'accept') {
    if (offer.auto_book) {
      const result = await acceptOfferAndBook(tenantId, String(offer.id));
      if (result.ok) {
        booked = true;
        outcome = `Consulta marcada para ${String(result.result.appointment.appt_date).slice(0, 10)} ${String(result.result.appointment.start_time).slice(0, 5)}`;
        await recordOfferBooking(result.result, SMS_ACTOR);
        // Antecipação aceite: o horário que o doente largou é uma vaga como
        // outra qualquer e vai à lista de espera antes de ficar vazio.
        const released = result.result.releasedSlot;
        if (released) {
          await notifyWaitlistOfFreedSlot(tenantId, released, released.cancellationId).catch((e) => {
            console.error(
              'notifyWaitlistOfFreedSlot (antecipação por SMS) falhou:',
              e instanceof Error ? e.message : e,
            );
          });
        }
      } else {
        // O doente disse sim e o sistema não conseguiu marcar. É o caso que
        // obriga mesmo a um telefonema: ele ficou à espera de uma consulta.
        outcome = `Aceitou mas não foi possível marcar: ${BOOK_ERROR_TEXT[result.error]}`;
        await createTask(tenantId, null, {
          patientId,
          type: 'call',
          title: `Ligar a ${patient.name} — aceitou a vaga mas ${BOOK_ERROR_TEXT[result.error]}`,
          notes: `Oferta ${String(offer.id).slice(0, 8)} · resposta: "${msg.body.slice(0, 100)}"`,
          autoAssign: true,
        });
      }
    } else {
      // A clínica não autorizou marcação automática: a oferta fica pendente e a
      // confirmação é de quem atende.
      outcome = 'Aceitou — a aguardar confirmação da receção';
      await createTask(tenantId, null, {
        patientId,
        type: 'call',
        title: `Confirmar vaga aceite por ${patient.name} — ${offerSlotTimes(offer).date} ${offerSlotTimes(offer).startTime}`,
        notes: 'O doente respondeu SIM a uma oferta de vaga. Confirmar na Lista de Espera.',
        autoAssign: true,
      });
    }
    await appendTimeline(patientId, SMS_ACTOR, 'admin', `Resposta a oferta de vaga: SIM. ${outcome}`);
  } else if (intent === 'decline') {
    await declineOffer(tenantId, String(offer.id));
    outcome = 'Recusou a vaga';
    await appendTimeline(patientId, SMS_ACTOR, 'admin', 'Resposta a oferta de vaga: NÃO');
  } else {
    // Ambígua. Não se marca nem se recusa nada: a oferta fica de pé até
    // expirar e uma pessoa lê a mensagem.
    outcome = 'Resposta por interpretar — enviada para a receção';
    await createTask(tenantId, null, {
      patientId,
      type: 'call',
      title: `Ler resposta de ${patient.name}: "${msg.body.slice(0, 60)}"`,
      notes: `Resposta a uma oferta de vaga para ${offerSlotTimes(offer).date} ${offerSlotTimes(offer).startTime} que o sistema não conseguiu interpretar.`,
      autoAssign: true,
    });
  }

  await logInbound({
    tenantId,
    patientId,
    offerId: offer ? String(offer.id) : null,
    from: msg.from,
    body: msg.body,
    intent,
    outcome,
    providerId: msg.providerId,
  });

  return {
    status: 'handled',
    intent,
    outcome,
    tenantId,
    patientId,
    offerId: offer ? String(offer.id) : null,
    booked,
  };
}
