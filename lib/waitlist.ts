import { canAutoContact } from './commPrefs';
import { query, queryOne } from './db';
import { createOffer } from './slotOffers';
import { type FreedSlot, rankCandidates, type WaitlistCandidate } from './waitlistMatch';

// A lista de espera: quem se inscreveu explicitamente à espera de vaga. Continua
// a ser a fonte de procura mais forte que existe (ver SOURCE_INTENT em
// lib/demandPoolCalc.ts) — deixou é de ser a única.
//
// O ciclo de vida da oferta mudou de casa para lib/slotOffers.ts na migração
// 046, quando uma oferta deixou de pertencer por construção a uma entrada desta
// lista. O que fica aqui é a lista em si e o caminho reativo do cancelamento:
// libertou-se uma vaga CONCRETA (mesmo tipo, mesmo dentista, mesma hora), logo
// quem a queria exatamente assim tem prioridade sobre qualquer pontuação. É por
// isso que este caminho não passa pelo Dynamic Scheduling.

const MAX_OFFERS_PER_SLOT = 3;
export const OFFER_EXPIRY_HOURS = 24;

// O ciclo de vida das ofertas vive em lib/slotOffers.ts desde a migração 046.
// Reexportado daqui porque as rotas e os jobs sempre o importaram deste módulo,
// e mudar o sítio de onde se importa não é a melhoria — a melhoria é a oferta
// ter deixado de depender da lista.
export {
  acceptOfferAndBook,
  type BookOfferError,
  type BookOfferResult,
  declineOffer,
  expireStaleOffers,
  getOffer,
  latestPendingOfferForPatient,
  recordOfferBooking,
} from './slotOffers';

export interface AddWaitlistInput {
  patientId: string;
  treatmentType: string;
  preferredDentistId?: string | null;
  preferredDays?: number[] | null;
  preferredTimeStart?: string | null;
  preferredTimeEnd?: string | null;
  minDuration?: number;
  maxWaitUntil?: string | null;
  notes?: string;
}

export async function addToWaitlist(tenantId: string, userId: string | null, input: AddWaitlistInput) {
  const [row] = await query(
    `INSERT INTO waitlist_entries
       (tenant_id, patient_id, treatment_type, preferred_dentist_id, preferred_days,
        preferred_time_start, preferred_time_end, min_duration, max_wait_until, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      tenantId,
      input.patientId,
      input.treatmentType,
      input.preferredDentistId || null,
      input.preferredDays?.length ? input.preferredDays : null,
      input.preferredTimeStart || null,
      input.preferredTimeEnd || null,
      Math.max(5, Number(input.minDuration) || 30),
      input.maxWaitUntil || null,
      input.notes || '',
      userId,
    ],
  );
  return row;
}

export async function listWaitlist(tenantId: string, status?: string | null) {
  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT w.*, p.name AS patient_name, p.phone, p.email
    FROM waitlist_entries w
    JOIN patients p ON p.id = w.patient_id
    WHERE w.tenant_id=$1`;
  if (status) {
    vals.push(status);
    sql += ` AND w.status=$${vals.length}`;
  }
  sql += ' ORDER BY w.created_at';
  return query(sql, vals);
}

// Todas as ofertas por responder, venham da lista de espera ou do agente. O JOIN
// à lista de espera passou a LEFT JOIN quando a oferta deixou de exigir uma
// entrada: com o INNER JOIN, uma oferta do Dynamic Scheduling simplesmente não
// aparecia na página, e a receção não sabia que ela existia.
export async function listPendingOffers(tenantId: string) {
  return query(
    `SELECT o.*, p.name AS patient_name, p.phone,
            COALESCE(o.offered_type, w.treatment_type) AS treatment_type
     FROM slot_offers o
     LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
     LEFT JOIN patients p ON p.id = o.patient_id
     WHERE o.tenant_id=$1 AND o.status='sent'
     ORDER BY o.created_at`,
    [tenantId],
  );
}

export async function updateWaitlistEntry(
  tenantId: string,
  id: string,
  updates: Partial<AddWaitlistInput> & { status?: string },
) {
  const prev = await queryOne(`SELECT * FROM waitlist_entries WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  if (!prev) return null;
  const [row] = await query(
    `UPDATE waitlist_entries
     SET treatment_type=$1, preferred_dentist_id=$2, preferred_days=$3, preferred_time_start=$4,
         preferred_time_end=$5, min_duration=$6, max_wait_until=$7, notes=$8, status=$9, updated_at=NOW()
     WHERE id=$10 AND tenant_id=$11
     RETURNING *`,
    [
      updates.treatmentType ?? prev.treatment_type,
      updates.preferredDentistId !== undefined ? updates.preferredDentistId : prev.preferred_dentist_id,
      updates.preferredDays !== undefined ? updates.preferredDays : prev.preferred_days,
      updates.preferredTimeStart !== undefined ? updates.preferredTimeStart : prev.preferred_time_start,
      updates.preferredTimeEnd !== undefined ? updates.preferredTimeEnd : prev.preferred_time_end,
      updates.minDuration !== undefined ? Math.max(5, Number(updates.minDuration) || 30) : prev.min_duration,
      updates.maxWaitUntil !== undefined ? updates.maxWaitUntil : prev.max_wait_until,
      updates.notes !== undefined ? updates.notes : prev.notes,
      updates.status ?? prev.status,
      id,
      tenantId,
    ],
  );
  return row;
}

function toCandidate(row: Record<string, unknown>): WaitlistCandidate {
  return {
    id: String(row.id),
    patient_id: String(row.patient_id),
    treatment_type: String(row.treatment_type || ''),
    preferred_dentist_id: (row.preferred_dentist_id as string) || null,
    preferred_days: (row.preferred_days as number[]) || null,
    preferred_time_start: (row.preferred_time_start as string) || null,
    preferred_time_end: (row.preferred_time_end as string) || null,
    min_duration: Number(row.min_duration),
    max_wait_until: (row.max_wait_until as string) || null,
    status: String(row.status),
    created_at: String(row.created_at),
  };
}

export async function findCandidates(
  tenantId: string,
  slot: FreedSlot,
  limit = MAX_OFFERS_PER_SLOT,
  excludeEntryIds: string[] = [],
) {
  const rows = excludeEntryIds.length
    ? await query(`SELECT * FROM waitlist_entries WHERE tenant_id=$1 AND status='active' AND id <> ALL($2::uuid[])`, [
        tenantId,
        excludeEntryIds,
      ])
    : await query(`SELECT * FROM waitlist_entries WHERE tenant_id=$1 AND status='active'`, [tenantId]);
  const candidates = rows.map(toCandidate);
  return rankCandidates(candidates, slot, new Date(), limit);
}

// Chamada quando uma consulta futura é cancelada (ou marcada como falta no
// próprio dia): oferece a vaga LIBERTADA a quem a queria exatamente assim.
//
// Este caminho não passa pela pontuação do Dynamic Scheduling de propósito. Uma
// vaga libertada tem tipo de tratamento e dentista concretos, e lib/waitlistMatch.ts
// filtra por eles; quem se inscreveu a pedir "Endodontia com a Dra. Costa" tem
// direito de preferência sobre um candidato que o motor pontuaria mais alto por
// outras razões. O Dynamic Scheduling trata do problema inverso — espaço vazio
// sem tipo nem dentista definidos.
//
// A marcação continua a exigir uma pessoa (ou um "SIM" do doente, com a política
// 'autobook' — ver app/api/webhooks/sms/route.ts).
export async function notifyWaitlistOfFreedSlot(
  tenantId: string,
  slot: FreedSlot,
  cancelledAppointmentId: string | null,
  excludeEntryIds: string[] = [],
) {
  const ranked = await findCandidates(tenantId, slot, MAX_OFFERS_PER_SLOT, excludeEntryIds);
  if (!ranked.length) return { offered: 0 };

  // A validade não pode ultrapassar o próprio horário oferecido: uma vaga para
  // amanhã de manhã não fica "à espera de resposta" 24 horas.
  const slotStart = new Date(`${slot.date}T${slot.startTime}:00`);
  const expiresAt = new Date(
    Math.min(Date.now() + OFFER_EXPIRY_HOURS * 3600_000, slotStart.getTime() || Number.POSITIVE_INFINITY),
  );

  let offered = 0;
  for (const c of ranked) {
    const patient = await queryOne(`SELECT name, phone, comm_prefs FROM patients WHERE id=$1`, [c.patient_id]);
    // Respeita um "não me mandem SMS" explícito, como todos os jobs automáticos
    // de lib/jobsRunner.ts (ver lib/commPrefs.ts) — uma oferta de vaga continua
    // a ser contacto automático, não uma pessoa a escrever uma mensagem.
    const phone = canAutoContact(patient?.comm_prefs, 'sms') ? patient?.phone || '' : '';

    const offer = await createOffer(tenantId, {
      source: 'waitlist',
      patientId: c.patient_id,
      patientName: patient?.name || null,
      phone,
      waitlistEntryId: c.id,
      cancelledAppointmentId,
      date: slot.date,
      startTime: slot.startTime,
      duration: slot.duration,
      chair: slot.chair,
      dentistId: slot.dentistId,
      type: slot.type || c.treatment_type,
      reason: 'Vaga libertada por cancelamento',
      expiresAt,
      // O caminho do cancelamento nunca marca sozinho: a página da lista de
      // espera é que confirma. Quem responde SIM a esta SMS cai no webhook, e é
      // lá que a política da clínica decide se isso marca ou fica pendente.
      autoBook: false,
      notificationKind: 'slot_offer',
      messageBody: `Olá ${patient?.name || ''}, ficou uma vaga disponível no dia ${slot.date} às ${slot.startTime}. Responda SIM para ficar com ela.`,
    });
    if (offer) offered += 1;
  }
  return { offered };
}
