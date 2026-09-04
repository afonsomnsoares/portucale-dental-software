import { appendAudit, appendTimeline } from './audit';
import type { SessionUser } from './auth';
import { query, queryOne, withTransaction } from './db';
import type { DemandSource } from './demandPoolCalc';
import { toE164 } from './validate';

// O ciclo de vida de uma oferta de vaga, agora independente da lista de espera.
//
// Até à migração 046 uma oferta era, por construção, uma linha da lista de
// espera: `slot_offers.waitlist_entry_id` era NOT NULL e o tipo de tratamento
// lia-se por join a essa entrada. Isso amarrava a única mecânica de
// preenchimento automático que o produto tinha à única fonte de procura que
// exigia opt-in — e a lista de espera é a menor das cinco (ver
// lib/demandPoolCalc.ts).
//
// Aqui a oferta passa a ser a unidade: um horário concreto proposto a um doente
// concreto, com validade, com a razão pela qual foi ele o escolhido, e com a
// indicação de se um "SIM" marca sozinho. De onde veio a procura é um campo.

export const LEGACY_OFFER_EXPIRY_HOURS = 24;

export interface CreateOfferInput {
  source: DemandSource;
  patientId: string;
  patientName?: string | null;
  phone?: string | null;
  waitlistEntryId?: string | null;
  cancelledAppointmentId?: string | null;
  advanceFromAppointmentId?: string | null;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  duration: number;
  chair: number;
  dentistId?: string | null;
  type: string;
  score?: number | null;
  reason?: string;
  estimatedValueEur?: number | null;
  expiresAt: Date;
  autoBook: boolean;
  /** O corpo da SMS. Sem telemóvel, a oferta é criada na mesma (fica na página). */
  messageBody: string;
  /** O 'kind' do payload da notificação — separa as ofertas dinâmicas das da lista de espera. */
  notificationKind?: string;
  /** Contexto extra para o payload (ex.: candidatos em standby). */
  notificationPayload?: Record<string, unknown>;
}

/**
 * Cria a oferta e, quando há telemóvel, mete a SMS na fila
 * (lib/jobsRunner.ts's sendDueNotifications trata do envio). Devolve null se o
 * doente já não existir.
 *
 * Note-se o que NÃO se faz aqui: verificar o consentimento. Isso é decisão de
 * quem constrói a lista (applyContactLimits em lib/demandPoolCalc.ts, e
 * canAutoContact em lib/waitlist.ts para o caminho do cancelamento) — misturar
 * a política com a escrita esconderia a política num sítio onde ninguém a
 * procura.
 */
export async function createOffer(tenantId: string, input: CreateOfferInput) {
  const phone = toE164(input.phone || '');
  const [notification] = phone
    ? await query(
        `INSERT INTO notifications
           (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
         VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())
         RETURNING *`,
        [
          tenantId,
          input.patientId,
          phone,
          JSON.stringify({
            kind: input.notificationKind || 'dynamic_offer',
            body: input.messageBody,
            ...(input.notificationPayload || {}),
          }),
        ],
      )
    : [null];

  const [offer] = await query(
    `INSERT INTO slot_offers
       (tenant_id, waitlist_entry_id, patient_id, cancelled_appointment_id, advance_from_appointment_id,
        offered_date, offered_start_time, offered_duration, offered_chair, offered_dentist_id,
        offered_type, source, score, reason, estimated_value_eur, expires_at, auto_book, notification_id)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      tenantId,
      input.waitlistEntryId || null,
      input.patientId,
      input.cancelledAppointmentId || null,
      input.advanceFromAppointmentId || null,
      input.date,
      input.startTime,
      input.duration,
      input.chair,
      input.dentistId || null,
      input.type,
      input.source,
      input.score ?? null,
      input.reason || '',
      input.estimatedValueEur ?? null,
      input.expiresAt.toISOString(),
      input.autoBook,
      notification?.id || null,
    ],
  );

  if (input.waitlistEntryId) {
    await query(`UPDATE waitlist_entries SET status='offered', updated_at=NOW() WHERE id=$1`, [input.waitlistEntryId]);
  }
  return offer || null;
}

// `offered_date` é DATE e o driver devolve-o como `Date` do JavaScript — cujo
// String() dá "Mon Mar 15 2027 ...". Cortar isso a 10 caracteres dá "Mon Mar 15",
// que o Postgres recusa como data na inserção seguinte. Daí as colunas ::text
// explícitas: o resto do módulo trabalha sempre sobre elas, nunca sobre a
// coluna crua. (O mesmo descuido existia no caminho antigo da lista de espera,
// onde ninguém tinha reparado porque só rebentava ao reoferecer.)
const OFFER_COLUMNS = `o.*,
            o.offered_date::text  AS offered_date_text,
            o.offered_start_time::text AS offered_start_time_text,
            COALESCE(o.offered_type, w.treatment_type) AS treatment_type`;

/** A oferta com o tipo já resolvido (o da própria oferta, ou o da entrada antiga). */
export async function getOffer(tenantId: string, offerId: string) {
  return queryOne(
    `SELECT ${OFFER_COLUMNS}
       FROM slot_offers o
       LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
      WHERE o.id=$1 AND o.tenant_id=$2`,
    [offerId, tenantId],
  );
}

/** 'YYYY-MM-DD' e 'HH:MM' de uma oferta, seja ela lida por getOffer ou crua. */
export function offerSlotTimes(offer: Record<string, unknown>) {
  const rawDate = offer.offered_date_text ?? offer.offered_date;
  const date = rawDate instanceof Date ? rawDate.toLocaleDateString('en-CA') : String(rawDate ?? '').slice(0, 10);
  return { date, startTime: String(offer.offered_start_time_text ?? offer.offered_start_time ?? '').slice(0, 5) };
}

/** A oferta pendente mais recente de um doente — o que uma resposta por SMS responde. */
export async function latestPendingOfferForPatient(tenantId: string, patientId: string) {
  return queryOne(
    `SELECT ${OFFER_COLUMNS}
       FROM slot_offers o
       LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
      WHERE o.tenant_id=$1 AND o.patient_id=$2 AND o.status='sent'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [tenantId, patientId],
  );
}

/**
 * As outras ofertas do MESMO horário deixam de fazer sentido quando uma é
 * aceite. Antes isto ligava-se só pela consulta cancelada que as tinha
 * originado; uma oferta do Dynamic Scheduling não nasce de cancelamento nenhum,
 * por isso a irmandade passa a ser também "mesma cadeira, mesmo dia, mesma
 * hora" — que é, afinal, a definição de estarem a disputar a mesma cadeira.
 */
async function declineSiblingOffers(tenantId: string, offer: Record<string, unknown>, exceptOfferId: string) {
  const siblings = await query(
    `SELECT * FROM slot_offers
      WHERE tenant_id=$1 AND status='sent' AND id<>$2
        AND (
          ($3::uuid IS NOT NULL AND cancelled_appointment_id = $3::uuid)
          OR (offered_date = $4::date AND offered_start_time = $5::time AND offered_chair IS NOT DISTINCT FROM $6)
        )`,
    [
      tenantId,
      exceptOfferId,
      offer.cancelled_appointment_id || null,
      offerSlotTimes(offer).date,
      offerSlotTimes(offer).startTime,
      offer.offered_chair ?? null,
    ],
  );
  for (const s of siblings) {
    await query(`UPDATE slot_offers SET status='expired', responded_at=NOW() WHERE id=$1`, [s.id]);
    if (s.waitlist_entry_id) {
      await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1 AND status='offered'`, [
        s.waitlist_entry_id,
      ]);
    }
  }
  return siblings.length;
}

export interface BookOfferResult {
  offer: Record<string, unknown>;
  appointment: Record<string, unknown>;
  /** Antecipação: a consulta antiga que foi libertada. */
  releasedSlot: {
    date: string;
    startTime: string;
    type: string;
    duration: number;
    dentistId: string | null;
    chair: number;
    cancellationId: string | null;
  } | null;
}

export type BookOfferError = 'not_found' | 'not_pending' | 'expired' | 'slot_taken' | 'no_patient';

class SlotTakenError extends Error {}

/**
 * Aceitar uma oferta e marcar. Chamada por uma pessoa na página da lista de
 * espera, e — com a política 'autobook' — pelo webhook de SMS quando o doente
 * responde SIM.
 *
 * Duas coisas que a versão anterior não fazia e passam a ser obrigatórias
 * agora que isto pode correr sem uma pessoa a olhar:
 *
 *   1. Confirmar que o horário AINDA está livre, dentro da transação e com o
 *      mesmo advisory lock de app/api/appointments/route.ts. Entre a oferta sair
 *      e o doente responder passam horas; a receção pode ter marcado ali outra
 *      pessoa entretanto. Uma pessoa a fazer isto à mão via o choque no ecrã —
 *      um webhook não vê nada.
 *   2. Recusar uma oferta já caducada, em vez de marcar uma consulta a partir de
 *      um SMS de anteontem.
 */
export async function acceptOfferAndBook(
  tenantId: string,
  offerId: string,
): Promise<{ ok: true; result: BookOfferResult } | { ok: false; error: BookOfferError }> {
  const offer = await getOffer(tenantId, offerId);
  if (!offer) return { ok: false, error: 'not_found' };
  if (offer.status !== 'sent') return { ok: false, error: 'not_pending' };
  if (offer.expires_at && new Date(String(offer.expires_at)).getTime() < Date.now()) {
    return { ok: false, error: 'expired' };
  }

  const patient = await queryOne(`SELECT id, name FROM patients WHERE id=$1 AND tenant_id=$2`, [
    offer.patient_id,
    tenantId,
  ]);
  if (!patient) return { ok: false, error: 'no_patient' };

  const dentist = offer.offered_dentist_id
    ? await queryOne(`SELECT id, name FROM users WHERE id=$1 AND role='dentist' AND active=TRUE AND tenant_id=$2`, [
        offer.offered_dentist_id,
        tenantId,
      ])
    : null;

  const { date, startTime } = offerSlotTimes(offer);
  const duration = Number(offer.offered_duration) || 30;
  const chair = Number(offer.offered_chair) || 1;

  let booked: { appointment: Record<string, unknown>; cancellationId: string | null };
  try {
    booked = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${tenantId}|${dentist?.id || 'sem-dentista'}|${date}`,
      ]);

      const { rows: clashes } = await client.query(
        `SELECT id FROM appointments
          WHERE tenant_id=$1 AND appt_date=$2::date
            AND (($3::uuid IS NOT NULL AND dentist_id=$3::uuid) OR chair=$4)
            AND start_time < ($5::time + make_interval(mins => $6::int))
            AND (start_time + make_interval(mins => duration)) > $5::time
          LIMIT 1`,
        [tenantId, date, dentist?.id || null, chair, startTime, duration],
      );
      if (clashes.length) throw new SlotTakenError();

      const { rows } = await client.query(
        `INSERT INTO appointments
           (tenant_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8,$9,'confirmed',$10)
         RETURNING *`,
        [
          tenantId,
          patient.id,
          patient.name,
          dentist?.id || null,
          chair,
          date,
          startTime,
          duration,
          offer.treatment_type || offer.offered_type || '',
          offerNote(String(offer.source || 'waitlist')),
        ],
      );
      const appointment = rows[0];

      // Antecipação: a consulta antiga sai na MESMA transação em que a nova
      // entra. Fazê-lo em dois passos deixaria o doente com duas marcações se o
      // segundo falhasse — e a consulta antiga é registada como cancelamento
      // (e não simplesmente apagada) para o espaço que ela liberta poder ser
      // reoferecido, que é metade do ganho de antecipar.
      let cancellationId: string | null = null;
      if (offer.advance_from_appointment_id) {
        const { rows: prevRows } = await client.query(
          `SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
          [offer.advance_from_appointment_id, tenantId],
        );
        const prev = prevRows[0];
        if (prev) {
          const { rows: cancelRows } = await client.query(
            `INSERT INTO appointment_cancellations
               (tenant_id, appointment_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time,
                duration, type, cancelled_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)
             RETURNING id`,
            [
              prev.tenant_id,
              prev.id,
              prev.patient_id,
              prev.patient_name,
              prev.dentist_id,
              prev.chair,
              prev.appt_date,
              prev.start_time,
              prev.duration,
              prev.type,
            ],
          );
          cancellationId = cancelRows[0]?.id || null;
          await client.query(`DELETE FROM appointments WHERE id=$1 AND tenant_id=$2`, [prev.id, tenantId]);
        }
      }

      return { appointment, cancellationId };
    });
  } catch (e) {
    if (e instanceof SlotTakenError) return { ok: false, error: 'slot_taken' };
    throw e;
  }

  await query(`UPDATE slot_offers SET status='accepted', responded_at=NOW(), appointment_id=$2 WHERE id=$1`, [
    offerId,
    booked.appointment.id,
  ]);
  if (offer.waitlist_entry_id) {
    await query(`UPDATE waitlist_entries SET status='fulfilled', updated_at=NOW() WHERE id=$1`, [
      offer.waitlist_entry_id,
    ]);
  }
  await declineSiblingOffers(tenantId, offer, offerId);

  const releasedSlot = offer.advance_from_appointment_id
    ? await releasedSlotFor(tenantId, String(offer.advance_from_appointment_id), booked.cancellationId)
    : null;

  return { ok: true, result: { offer, appointment: booked.appointment, releasedSlot } };
}

function offerNote(source: string) {
  const NOTES: Record<string, string> = {
    waitlist: 'Marcado a partir da lista de espera',
    treatment_open: 'Marcado pelo agente de agenda — plano de tratamento parado',
    recall_due: 'Marcado pelo agente de agenda — recall vencido',
    advance: 'Marcado pelo agente de agenda — consulta antecipada',
    reactivation: 'Marcado pelo agente de agenda — reativação',
  };
  return NOTES[source] || 'Marcado pelo agente de agenda';
}

// O espaço que a antecipação libertou, lido do registo de cancelamento (a
// consulta já não existe nessa altura).
async function releasedSlotFor(tenantId: string, appointmentId: string, cancellationId: string | null) {
  const row = await queryOne(
    `SELECT appt_date::text AS appt_date, start_time::text AS start_time, duration, type, dentist_id, chair
       FROM appointment_cancellations
      WHERE tenant_id=$1 AND appointment_id=$2
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, appointmentId],
  );
  if (!row) return null;
  return {
    date: String(row.appt_date).slice(0, 10),
    startTime: String(row.start_time).slice(0, 5),
    type: String(row.type || ''),
    duration: Number(row.duration) || 30,
    dentistId: (row.dentist_id as string) || null,
    chair: Number(row.chair) || 1,
    cancellationId,
  };
}

/**
 * O doente recusou (ou a receção registou a recusa por ele). A entrada da lista
 * de espera volta a ficar ativa.
 *
 * Ao contrário da versão anterior, NÃO se reoferece o horário aqui. Antes fazia
 * sentido porque a única fonte era a lista de espera e o "próximo da fila" era
 * uma pergunta com resposta imediata. Agora o próximo candidato depende de cinco
 * fontes, da pontuação e dos limites do dia — é o trabalho do Dynamic
 * Scheduling, que corre logo a seguir e volta a ver o mesmo espaço vazio. Manter
 * as duas vias produzia duas ofertas para a mesma cadeira.
 */
export async function declineOffer(tenantId: string, offerId: string) {
  const offer = await getOffer(tenantId, offerId);
  if (offer?.status !== 'sent') return null;

  await query(`UPDATE slot_offers SET status='declined', responded_at=NOW() WHERE id=$1`, [offerId]);
  if (offer.waitlist_entry_id) {
    await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1`, [offer.waitlist_entry_id]);
  }
  return { offer };
}

/**
 * Marca as ofertas sem resposta como caducadas. `expires_at` manda; as ofertas
 * anteriores à migração 046 não o têm e mantêm as 24 horas com que nasceram.
 */
export async function expireStaleOffers(tenantId: string) {
  const stale = await query(
    `SELECT ${OFFER_COLUMNS}
       FROM slot_offers o
       LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
      WHERE o.tenant_id=$1 AND o.status='sent'
        AND COALESCE(o.expires_at, o.created_at + ($2::int * INTERVAL '1 hour')) < NOW()`,
    [tenantId, LEGACY_OFFER_EXPIRY_HOURS],
  );

  let expired = 0;
  for (const o of stale) {
    await query(`UPDATE slot_offers SET status='expired', responded_at=NOW() WHERE id=$1`, [o.id]);
    if (o.waitlist_entry_id) {
      await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1 AND status='offered'`, [
        o.waitlist_entry_id,
      ]);
    }
    expired += 1;
  }
  // `reoffered` mantém-se no resultado (é o que job_runs já grava desde a
  // primeira versão) mas é sempre 0: reoferecer passou a ser trabalho do
  // Dynamic Scheduling — ver declineOffer acima.
  return { expired, reoffered: 0 };
}

/** Regista na ficha do doente e no audit_log que uma oferta virou consulta. */
export async function recordOfferBooking(
  result: BookOfferResult,
  actor: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'>,
) {
  const apt = result.appointment;
  const when = `${String(apt.appt_date).slice(0, 10)} ${String(apt.start_time).slice(0, 5)}`;
  await appendTimeline(
    String(apt.patient_id),
    actor,
    'admin',
    `Consulta marcada por oferta aceite: ${apt.type} em ${when}`,
  );
  await appendAudit(actor, 'CREATE', `Oferta aceite — ${apt.type} em ${when}`, null, 'confirmed', actor.clinic);
  if (result.releasedSlot) {
    await appendTimeline(
      String(apt.patient_id),
      actor,
      'admin',
      `Consulta anterior de ${result.releasedSlot.date} ${result.releasedSlot.startTime} libertada por antecipação`,
    );
  }
}
