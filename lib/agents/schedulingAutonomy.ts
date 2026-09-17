import { appendAudit, appendTimeline } from '../audit';
import { canAutoContact } from '../commPrefs';
import { formatDatePT, getDefaultDuration } from '../constants';
import { query, queryOne, withTransaction } from '../db';
import { requireIsoDate } from '../pgDate';
import { suggestAppointmentSlots } from '../scheduling';
import { toE164 } from '../validate';

// ─── O software a escrever na agenda ────────────────────────────────────────
// Este ficheiro é a única porta por onde a autonomia de agenda passa. Existe separado
// das rotas e das tarefas por uma razão: se o software pode cancelar e marcar consultas
// sozinho, o conjunto exato do que ele pode fazer tem de caber num ficheiro que uma
// pessoa consiga ler de uma assentada.
//
// O que ele faz:
//   • cancelar UMA consulta identificada sem ambiguidade, a pedido do doente;
//   • oferecer UM lugar concreto, que só vira consulta se o doente responder.
//
// O que ele nunca faz, e não há degrau que o ligue:
//   • tocar em tratamentos, planos ou seja o que for clínico;
//   • contactar quem recusou contacto automático (lib/commPrefs.ts);
//   • escolher por um doente que tem mais do que uma consulta marcada — ver
//     canActOnSchedule em lib/conversationCalc.ts;
//   • marcar sem oferecer: não existe caminho em que uma consulta apareça na agenda de
//     alguém sem esse alguém ter dito que sim a um dia e uma hora concretos.
//
// Tudo o que sai daqui fica no registo de auditoria e na timeline do doente identificado
// como automático. Uma consulta que desaparece da agenda sem se saber quem a tirou é
// exatamente o que faz uma clínica desligar isto no primeiro susto.

/** Ator do registo, para a auditoria distinguir isto de uma pessoa. */
const AGENT_ACTOR = {
  id: '',
  name: 'Agenda (automático)',
  role: 'system',
  clinic: '',
} as const;

function actor(clinic: string) {
  return { ...AGENT_ACTOR, clinic };
}

/** As consultas futuras por realizar de um doente — a base de toda a desambiguação. */
export async function upcomingAppointments(tenantId: string, patientId: string) {
  return query(
    `SELECT id, appt_date::text AS appt_date, start_time::text AS start_time, duration, type, chair, dentist_id
       FROM appointments
      WHERE tenant_id=$1 AND patient_id=$2 AND appt_date >= CURRENT_DATE
        AND status IN ('confirmed','waiting')
      ORDER BY appt_date, start_time`,
    [tenantId, patientId],
  );
}

export async function hasPendingOffer(tenantId: string, patientId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM slot_offers WHERE tenant_id=$1 AND patient_id=$2 AND status='sent' AND origin <> 'waitlist' LIMIT 1`,
    [tenantId, patientId],
  );
  return !!row;
}

// ─── Cancelar ───────────────────────────────────────────────────────────────
// Faz exatamente o que a rota DELETE de uma consulta faz, e de propósito: grava a linha
// em appointment_cancellations (que é o que alimenta o risco de falta, a previsão e o
// ecrã de cancelamentos) e liberta a vaga para a lista de espera. Um cancelamento feito
// por um SMS não pode ser um cancelamento de segunda categoria, invisível a tudo o que
// conta os outros.
export interface CancelResult {
  cancelled: { id: string; date: string; startTime: string; type: string };
  waitlistOffered: number;
}

export async function cancelForPatient(
  tenantId: string,
  patientId: string,
  motivo: string,
): Promise<CancelResult | null> {
  const futuras = await upcomingAppointments(tenantId, patientId);
  // Segunda verificação da regra que canActOnSchedule já aplicou a montante. Não é
  // duplicação por esquecimento: a leitura de lá aconteceu antes de se escrever a
  // mensagem recebida, e entre as duas cabe uma marcação feita ao balcão.
  if (futuras.length !== 1) return null;
  const apt = futuras[0];

  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  const quem = actor(String(tenant?.name || ''));

  const cancellation = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO appointment_cancellations
         (tenant_id, appointment_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, cancelled_by)
       SELECT a.tenant_id, a.id, a.patient_id, COALESCE(p.name, a.patient_name), a.dentist_id, a.chair,
              a.appt_date, a.start_time, a.duration, a.type, NULL
         FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.id=$1 AND a.tenant_id=$2
       RETURNING *`,
      [apt.id, tenantId],
    );
    await client.query(`DELETE FROM appointments WHERE id=$1 AND tenant_id=$2`, [apt.id, tenantId]);
    return rows[0];
  });

  await appendAudit(
    quem,
    'DELETE',
    `Consulta cancelada pelo doente (${motivo})`,
    `${apt.appt_date} ${String(apt.start_time).slice(0, 5)}`,
    'cancelled',
    quem.clinic,
  );
  await appendTimeline(
    patientId,
    quem,
    'admin',
    `Consulta de ${apt.appt_date} às ${String(apt.start_time).slice(0, 5)} cancelada automaticamente a pedido do doente (${motivo}).`,
  );

  // A vaga vai à lista de espera pelo caminho de sempre. Importado aqui dentro e não no
  // topo para não criar um ciclo: lib/waitlist.ts importa lib/scheduling.ts, que este
  // ficheiro também usa.
  const { notifyWaitlistOfFreedSlot } = await import('../waitlist');
  let waitlistOffered = 0;
  try {
    const r = await notifyWaitlistOfFreedSlot(
      tenantId,
      {
        date: requireIsoDate(apt.appt_date, 'appt_date'),
        startTime: String(apt.start_time).slice(0, 5),
        type: String(apt.type),
        duration: Number(apt.duration) || 30,
        dentistId: (apt.dentist_id as string) || null,
        chair: Number(apt.chair) || 1,
      },
      cancellation?.id || null,
    );
    waitlistOffered = r.offered;
  } catch (e) {
    // Nunca falhar o cancelamento por causa do que vem a seguir — mesma regra da rota
    // DELETE. A consulta já está cancelada; a lista de espera é o bónus.
    console.error('cancelForPatient: notifyWaitlistOfFreedSlot falhou:', e instanceof Error ? e.message : e);
  }

  return {
    cancelled: {
      id: String(apt.id),
      date: String(apt.appt_date),
      startTime: String(apt.start_time).slice(0, 5),
      type: String(apt.type),
    },
    waitlistOffered,
  };
}

// ─── Oferecer um lugar ──────────────────────────────────────────────────────
// UM lugar, não uma lista. Três opções por SMS obrigam o doente a responder «a segunda»,
// e a classificação por palavras-chave não sabe ler isso — produziria uma marcação
// errada com ar de confirmação. Um lugar tem uma resposta binária, e é a única que a
// classificação acerta sempre.
//
// Se não servir, o doente diz que não e a conversa vai para uma pessoa, que é onde
// devia ter estado desde o início nesse caso.
export interface OfferResult {
  offerId: string;
  date: string;
  startTime: string;
  body: string;
}

// ─── Encontrar e oferecer são passos separados, de propósito ───────────────
// Uma oferta feita à caixa de entrada é uma RESPOSTA: o doente acabou de escrever, e o
// SMS sai já. Uma oferta feita pelo recall é OUTREACH: o doente não pediu nada, e por
// isso tem de passar pelo árbitro (lib/agents/coordination.ts), que decide com todos os
// pedidos da passagem à vista.
//
// Se as duas partilhassem uma função que persiste e envia, o recall passaria à frente do
// árbitro — e um doente com um lembrete de consulta e um recall no mesmo dia receberia os
// dois, que é exatamente o que o árbitro existe para impedir. Por isso: encontrar o lugar
// não escreve nada, e persistir a oferta é um passo à parte que o recall só dá depois de
// o árbitro ter autorizado.
export interface OfferableSlot {
  date: string;
  startTime: string;
  chair: number;
  dentistId: string;
  type: string;
  duration: number;
  body: string;
}

export async function findOfferableSlot(
  tenantId: string,
  patientId: string,
  type?: string | null,
): Promise<OfferableSlot | null> {
  const patient = await queryOne(`SELECT id, name, phone, comm_prefs FROM patients WHERE id=$1 AND tenant_id=$2`, [
    patientId,
    tenantId,
  ]);
  if (!patient) return null;
  if (!canAutoContact(patient.comm_prefs, 'sms') || !toE164(patient.phone)) return null;

  // Já tem uma oferta à espera de resposta: não se oferece outra. O índice único da
  // migração 062 impõe-o na base de dados; isto evita chegar lá e apanhar um 23505.
  if (await hasPendingOffer(tenantId, patientId)) return null;

  const tipo = String(type || '').trim() || 'Consulta de Avaliação';
  const duration = getDefaultDuration(tipo);
  const { slots } = await suggestAppointmentSlots({ tenantId, type: tipo, duration, patientId, limit: 1, days: 21 });
  if (!slots.length) return null;
  const slot = slots[0];

  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  return {
    date: slot.date,
    startTime: slot.startTime,
    chair: slot.chair,
    dentistId: slot.dentistId,
    type: tipo,
    duration,
    body: `Olá ${patient.name}, temos vaga em ${tenant?.name || ''} no dia ${formatDatePT(slot.date)} às ${slot.startTime} (${tipo}). Responda SIM para ficar com ela, ou contacte-nos para outro horário.`,
  };
}

/**
 * Grava a oferta. `notificationId` vem do árbitro quando a origem é o recall; a caixa de
 * entrada passa null e envia a mensagem pelo caminho normal das respostas.
 */
export async function persistOffer(
  tenantId: string,
  patientId: string,
  slot: OfferableSlot,
  opts: {
    origin: 'recall' | 'inbound';
    conversationId?: string | null;
    recallId?: string | null;
    notificationId?: string | null;
  },
): Promise<string | null> {
  const [offer] = await query(
    `INSERT INTO slot_offers
       (tenant_id, patient_id, offered_date, offered_start_time, offered_duration, offered_chair,
        offered_dentist_id, notification_id, origin, offered_type, conversation_id, recall_id)
     VALUES ($1,$2,$3::date,$4::time,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      tenantId,
      patientId,
      slot.date,
      slot.startTime,
      slot.duration,
      slot.chair,
      slot.dentistId,
      opts.notificationId || null,
      opts.origin,
      slot.type,
      opts.conversationId || null,
      opts.recallId || null,
    ],
  );
  // ON CONFLICT DO NOTHING cobre a corrida contra o índice único de uma oferta pendente
  // por doente: duas passagens sobrepostas não produzem duas ofertas.
  if (!offer) return null;

  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  await appendTimeline(
    patientId,
    actor(String(tenant?.name || '')),
    'admin',
    `Lugar oferecido automaticamente: ${slot.date} às ${slot.startTime} (${slot.type}).`,
  );
  return String(offer.id);
}

/** O caminho da caixa de entrada: encontrar, gravar e devolver o texto a enviar. */
export async function offerSlotToPatient(
  tenantId: string,
  patientId: string,
  opts: {
    type?: string | null;
    origin: 'recall' | 'inbound';
    conversationId?: string | null;
    recallId?: string | null;
  },
): Promise<OfferResult | null> {
  const slot = await findOfferableSlot(tenantId, patientId, opts.type);
  if (!slot) return null;
  const offerId = await persistOffer(tenantId, patientId, slot, opts);
  if (!offerId) return null;
  return { offerId, date: slot.date, startTime: slot.startTime, body: slot.body };
}

/** A oferta pendente deste doente, para a aceitação saber sobre o que está a falar. */
export async function pendingOfferFor(tenantId: string, patientId: string) {
  return queryOne(
    `SELECT * FROM slot_offers
      WHERE tenant_id=$1 AND patient_id=$2 AND status='sent' AND origin <> 'waitlist'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, patientId],
  );
}
