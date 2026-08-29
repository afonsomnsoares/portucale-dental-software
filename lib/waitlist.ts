import { query, queryOne } from './db';
import { toE164 } from './validate';
import { type FreedSlot, rankCandidates, type WaitlistCandidate } from './waitlistMatch';

const MAX_OFFERS_PER_SLOT = 3;
export const OFFER_EXPIRY_HOURS = 24;

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

export async function listPendingOffers(tenantId: string) {
  return query(
    `SELECT o.*, p.name AS patient_name, p.phone, w.treatment_type
     FROM slot_offers o
     JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
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

// Called when a future appointment is cancelled: finds waitlist candidates for the freed
// slot, offers it to up to MAX_OFFERS_PER_SLOT of them (SMS, via the existing
// notifications queue), and marks those entries 'offered'. The receptionist confirms the
// actual booking by hand from the Waitlist page once a patient replies.
export async function notifyWaitlistOfFreedSlot(
  tenantId: string,
  slot: FreedSlot,
  cancelledAppointmentId: string | null,
  excludeEntryIds: string[] = [],
) {
  const ranked = await findCandidates(tenantId, slot, MAX_OFFERS_PER_SLOT, excludeEntryIds);
  if (!ranked.length) return { offered: 0 };

  let offered = 0;
  for (const c of ranked) {
    const patient = await queryOne(`SELECT name, phone FROM patients WHERE id=$1`, [c.patient_id]);
    const phone = toE164(patient?.phone);

    const body = `Olá ${patient?.name || ''}, ficou uma vaga disponível no dia ${slot.date} às ${slot.startTime}. Contacte-nos se quiser ficar com ela.`;
    const [notification] = phone
      ? await query(
          `INSERT INTO notifications
             (tenant_id, patient_id, channel, to_addr, payload, status, next_retry_at)
           VALUES ($1,$2,'sms',$3,$4::jsonb,'queued',NOW())
           RETURNING *`,
          [tenantId, c.patient_id, phone, JSON.stringify({ kind: 'slot_offer', body })],
        )
      : [null];

    const [offer] = await query(
      `INSERT INTO slot_offers
         (tenant_id, waitlist_entry_id, patient_id, cancelled_appointment_id,
          offered_date, offered_start_time, offered_duration, offered_chair, offered_dentist_id, notification_id)
       VALUES ($1,$2,$3,$4,$5::date,$6::time,$7,$8,$9,$10)
       RETURNING *`,
      [
        tenantId,
        c.id,
        c.patient_id,
        cancelledAppointmentId,
        slot.date,
        slot.startTime,
        slot.duration,
        slot.chair,
        slot.dentistId,
        notification?.id || null,
      ],
    );
    await query(`UPDATE waitlist_entries SET status='offered', updated_at=NOW() WHERE id=$1`, [c.id]);
    if (offer) offered += 1;
  }
  return { offered };
}

export async function getOffer(tenantId: string, offerId: string) {
  return queryOne(
    `SELECT o.*, w.treatment_type
     FROM slot_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
     WHERE o.id=$1 AND o.tenant_id=$2`,
    [offerId, tenantId],
  );
}

// Other pending offers for the same freed slot become moot once one candidate is booked
// (or all are given up on) — decline them too and let their entries go back to 'active'.
async function declineSiblingOffers(tenantId: string, cancelledAppointmentId: string | null, exceptOfferId: string) {
  if (!cancelledAppointmentId) return;
  const siblings = await query(
    `SELECT * FROM slot_offers
     WHERE tenant_id=$1 AND cancelled_appointment_id=$2 AND status='sent' AND id<>$3`,
    [tenantId, cancelledAppointmentId, exceptOfferId],
  );
  for (const s of siblings) {
    await query(`UPDATE slot_offers SET status='expired', responded_at=NOW() WHERE id=$1`, [s.id]);
    await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1 AND status='offered'`, [
      s.waitlist_entry_id,
    ]);
  }
}

// Patient declined (or the receptionist recorded a decline on their behalf): free the
// entry back up and try the next-in-line candidate for that same slot.
export async function declineOffer(tenantId: string, offerId: string) {
  const offer = await getOffer(tenantId, offerId);
  if (!offer || offer.status !== 'sent') return null;

  await query(`UPDATE slot_offers SET status='declined', responded_at=NOW() WHERE id=$1`, [offerId]);
  await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1`, [offer.waitlist_entry_id]);

  const slot: FreedSlot = {
    date: String(offer.offered_date).slice(0, 10),
    startTime: String(offer.offered_start_time).slice(0, 5),
    duration: Number(offer.offered_duration),
    dentistId: (offer.offered_dentist_id as string) || null,
    chair: Number(offer.offered_chair) || 1,
  };
  let reoffered = 0;
  if (slot.date >= new Date().toISOString().slice(0, 10)) {
    const result = await notifyWaitlistOfFreedSlot(tenantId, slot, offer.cancelled_appointment_id, [
      offer.waitlist_entry_id,
    ]);
    reoffered = result.offered;
  }
  return { offer, reoffered };
}

export interface BookOfferResult {
  offer: Record<string, unknown>;
  appointment: Record<string, unknown>;
}

// Receptionist confirms the patient accepted: creates the real appointment on the freed
// slot, marks this offer accepted + the entry fulfilled, and drops the other candidates
// who were offered the same slot.
export async function acceptOfferAndBook(tenantId: string, offerId: string): Promise<BookOfferResult | null> {
  const offer = await getOffer(tenantId, offerId);
  if (!offer || offer.status !== 'sent') return null;

  const patient = await queryOne(`SELECT id, name FROM patients WHERE id=$1 AND tenant_id=$2`, [
    offer.patient_id,
    tenantId,
  ]);
  if (!patient) return null;

  const dentist = offer.offered_dentist_id
    ? await queryOne(`SELECT id, name FROM users WHERE id=$1 AND role='dentist' AND active=TRUE AND tenant_id=$2`, [
        offer.offered_dentist_id,
        tenantId,
      ])
    : null;

  const [appointment] = await query(
    `INSERT INTO appointments
       (tenant_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8,$9,'confirmed',$10)
     RETURNING *`,
    [
      tenantId,
      patient.id,
      patient.name,
      dentist?.id || null,
      offer.offered_chair || 1,
      offer.offered_date,
      offer.offered_start_time,
      offer.offered_duration,
      offer.treatment_type,
      'Marcado a partir da lista de espera',
    ],
  );

  await query(`UPDATE slot_offers SET status='accepted', responded_at=NOW() WHERE id=$1`, [offerId]);
  await query(`UPDATE waitlist_entries SET status='fulfilled', updated_at=NOW() WHERE id=$1`, [
    offer.waitlist_entry_id,
  ]);
  await declineSiblingOffers(tenantId, offer.cancelled_appointment_id, offerId);

  return { offer, appointment };
}

// Marks unanswered offers older than OFFER_EXPIRY_HOURS as expired, reverts the entry to
// 'active' so it can be matched again, and tries the next candidate for that same slot.
export async function expireStaleOffers(tenantId: string) {
  const stale = await query(
    `SELECT * FROM slot_offers
     WHERE tenant_id=$1 AND status='sent' AND created_at < NOW() - ($2::int * INTERVAL '1 hour')`,
    [tenantId, OFFER_EXPIRY_HOURS],
  );

  let expired = 0;
  let reoffered = 0;
  for (const o of stale) {
    await query(`UPDATE slot_offers SET status='expired', responded_at=NOW() WHERE id=$1`, [o.id]);
    await query(`UPDATE waitlist_entries SET status='active', updated_at=NOW() WHERE id=$1 AND status='offered'`, [
      o.waitlist_entry_id,
    ]);
    expired += 1;

    const slot: FreedSlot = {
      date: String(o.offered_date).slice(0, 10),
      startTime: String(o.offered_start_time).slice(0, 5),
      duration: Number(o.offered_duration),
      dentistId: (o.offered_dentist_id as string) || null,
      chair: Number(o.offered_chair) || 1,
    };
    if (slot.date >= new Date().toISOString().slice(0, 10)) {
      const result = await notifyWaitlistOfFreedSlot(tenantId, slot, o.cancelled_appointment_id, [o.waitlist_entry_id]);
      reoffered += result.offered;
    }
  }
  return { expired, reoffered };
}
