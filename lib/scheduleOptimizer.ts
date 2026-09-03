import { APPOINTMENT_TYPES, getAppointmentTypeOption } from './constants';
import { query, queryOne } from './db';
import {
  type Booking,
  buildEquipmentBlockMoves,
  buildGapFillMoves,
  buildPreferenceMismatchMoves,
  buildUnassignedDentistMoves,
  findOpenings,
  type OptimizerMove,
  rankMoves,
  waitlistFitsOpening,
} from './scheduleOptimizerCalc';
import { addDays, minutesToTime, toMinutes, weekdayOf } from './scheduling';
import { getPreferencesForPatients } from './schedulingPrefs';
import { preferenceFit } from './schedulingPrefsCalc';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário / maximizar a
// utilização da capacidade disponível". lib/scheduleIntel.ts já mede a agenda;
// isto propõe o que fazer com a medição. A lógica de decisão vive toda em
// lib/scheduleOptimizerCalc.ts (pura, testada); aqui só se lê a agenda e se
// ligam os sinais.
//
// Nada é executado automaticamente. Mover uma consulta obriga a avisar o doente,
// e essa é uma decisão de quem atende, não do software — as propostas saem
// ordenadas por ganho para alguém decidir.

const DEFAULT_WINDOW_DAYS = 14;
// Só se propõe encaixar alguém num espaço a partir desta duração — abaixo disto
// não cabe nenhum tratamento real (a consulta mais curta em APPOINTMENT_TYPES são
// 15 min) e a lista encheria-se de ruído.
const MIN_USEFUL_OPENING_MINUTES = 30;
// Usado só quando NENHUM turno está configurado para esse dia da semana. A
// alternativa seria não propor nada numa clínica que ainda não montou os
// horários da equipa, o que faria a funcionalidade parecer avariada. Sinalizado
// em `warnings` para não passar por dado real.
const FALLBACK_DAY_WINDOW = { openMinutes: 9 * 60, closeMinutes: 19 * 60 };

export interface OptimizerResult {
  windowDays: number;
  generatedAt: string;
  moves: OptimizerMove[];
  totals: { moves: number; recoverableMinutes: number };
  warnings: string[];
}

export async function computeScheduleOptimization(
  tenantId: string,
  days = DEFAULT_WINDOW_DAYS,
): Promise<OptimizerResult> {
  const today = new Date().toLocaleDateString('en-CA');
  const toDate = addDays(today, Math.max(0, days - 1));
  const warnings: string[] = [];

  const [tenant, appts, equipment, waitlist, shifts, timeOff, dentistLoad] = await Promise.all([
    queryOne(`SELECT operatories FROM tenants WHERE id=$1`, [tenantId]),
    query(
      `SELECT a.id, a.chair, a.appt_date::text AS appt_date, a.start_time::text AS start_time, a.duration,
              a.dentist_id, a.patient_id, a.type, COALESCE(p.name, a.patient_name, '—') AS patient_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.tenant_id=$1 AND a.appt_date BETWEEN $2::date AND $3::date
         AND a.status NOT IN ('no-show','departed')
       ORDER BY a.appt_date, a.chair, a.start_time`,
      [tenantId, today, toDate],
    ),
    query(`SELECT chair, tags FROM clinic_equipment WHERE tenant_id=$1 AND active=TRUE AND chair IS NOT NULL`, [
      tenantId,
    ]),
    query(
      `SELECT w.id, w.min_duration, w.preferred_days, w.treatment_type, w.status,
              w.preferred_time_start::text, w.preferred_time_end::text, w.max_wait_until::text,
              COALESCE(p.name,'—') AS patient_name
       FROM waitlist_entries w
       LEFT JOIN patients p ON p.id = w.patient_id
       WHERE w.tenant_id=$1 AND w.status='active'
       ORDER BY w.created_at`,
      [tenantId],
    ),
    query(
      `SELECT s.user_id, s.weekday, s.start_time::text, s.end_time::text
       FROM staff_schedules s JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id=$1 AND u.role='dentist' AND u.active=TRUE`,
      [tenantId],
    ),
    query(
      `SELECT user_id, start_date::text, end_date::text FROM staff_time_off
       WHERE tenant_id=$1 AND status='approved' AND end_date >= $2::date`,
      [tenantId, today],
    ),
    query(
      `SELECT u.id, u.name, COALESCE(SUM(a.duration),0)::int AS booked_minutes
       FROM users u
       LEFT JOIN appointments a
         ON a.dentist_id = u.id AND a.tenant_id=$1
            AND a.appt_date BETWEEN $2::date AND $3::date AND a.status NOT IN ('no-show','departed')
       WHERE u.tenant_id=$1 AND u.role='dentist' AND u.active=TRUE
       GROUP BY u.id, u.name`,
      [tenantId, today, toDate],
    ),
  ]);

  const chairCount = Math.max(1, Number(tenant?.operatories || 1));
  const dateList = Array.from({ length: days }, (_, i) => addDays(today, i));

  const bookings: Booking[] = appts.map((a) => ({
    appointmentId: String(a.id),
    chair: Number(a.chair),
    date: String(a.appt_date),
    startMinutes: toMinutes(String(a.start_time)),
    durationMinutes: Number(a.duration || 30),
    dentistId: (a.dentist_id as string) || null,
    patientId: (a.patient_id as string) || null,
    patientName: String(a.patient_name),
    type: String(a.type),
  }));

  // ─── Janela de funcionamento por dia, a partir dos turnos reais ──────────
  const shiftsByWeekday = new Map<number, Array<{ start: number; end: number }>>();
  for (const s of shifts) {
    const wd = Number(s.weekday);
    const list = shiftsByWeekday.get(wd) || [];
    list.push({ start: toMinutes(String(s.start_time)), end: toMinutes(String(s.end_time)) });
    shiftsByWeekday.set(wd, list);
  }
  let usedFallbackWindow = false;
  const windowFor = (date: string) => {
    const blocks = shiftsByWeekday.get(weekdayOf(date));
    if (!blocks?.length) {
      usedFallbackWindow = true;
      return FALLBACK_DAY_WINDOW;
    }
    return {
      openMinutes: Math.min(...blocks.map((b) => b.start)),
      closeMinutes: Math.max(...blocks.map((b) => b.end)),
    };
  };

  // ─── Regra 1: buracos preenchíveis pela lista de espera ──────────────────
  const bookingsByChairDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const key = `${b.date}|${b.chair}`;
    const list = bookingsByChairDay.get(key) || [];
    list.push(b);
    bookingsByChairDay.set(key, list);
  }

  const openings = [];
  for (const date of dateList) {
    const win = windowFor(date);
    for (let chair = 1; chair <= chairCount; chair++) {
      const dayBookings = bookingsByChairDay.get(`${date}|${chair}`);
      if (!dayBookings?.length) {
        // Uma cadeira-dia completamente vazia é uma ponta livre do tamanho do dia
        // inteiro — não passa por findOpenings, que precisa de pelo menos uma
        // marcação para saber de que cadeira/dia se trata.
        openings.push({
          chair,
          date,
          startMinutes: win.openMinutes,
          endMinutes: win.closeMinutes,
          durationMinutes: win.closeMinutes - win.openMinutes,
          kind: 'edge' as const,
        });
        continue;
      }
      openings.push(...findOpenings(dayBookings, win, MIN_USEFUL_OPENING_MINUTES));
    }
  }

  const waitlistCandidates = waitlist.map((w) => ({
    waitlistEntryId: String(w.id),
    patientName: String(w.patient_name),
    treatmentType: String(w.treatment_type),
    minDuration: Number(w.min_duration || 30),
    candidate: {
      preferredDays: Array.isArray(w.preferred_days) ? (w.preferred_days as number[]).map(Number) : null,
      preferredTimeStart: w.preferred_time_start ? String(w.preferred_time_start).slice(0, 5) : null,
      preferredTimeEnd: w.preferred_time_end ? String(w.preferred_time_end).slice(0, 5) : null,
      minDuration: Number(w.min_duration || 30),
      maxWaitUntil: w.max_wait_until ? String(w.max_wait_until) : null,
      status: String(w.status),
    },
  }));

  // Indexado por id para a função de compatibilidade poder chegar aos campos
  // crus da entrada sem os arrastar dentro de WaitlistFit, que é o que a UI vê.
  const candidateById = new Map(waitlistCandidates.map((w) => [w.waitlistEntryId, w.candidate]));
  const gapFill = buildGapFillMoves(
    openings.filter((o) => o.durationMinutes >= MIN_USEFUL_OPENING_MINUTES),
    waitlistCandidates.map((w) => ({
      waitlistEntryId: w.waitlistEntryId,
      patientName: w.patientName,
      treatmentType: w.treatmentType,
      minDuration: w.minDuration,
    })),
    (fit, opening) => {
      const raw = candidateById.get(fit.waitlistEntryId);
      return !!raw && waitlistFitsOpening(raw, opening, today);
    },
    minutesToTime,
  );

  // ─── Regra 2: consultas sem dentista ─────────────────────────────────────
  const onLeave = new Map<string, Array<{ start: string; end: string }>>();
  for (const t of timeOff) {
    const list = onLeave.get(String(t.user_id)) || [];
    list.push({ start: String(t.start_date), end: String(t.end_date) });
    onLeave.set(String(t.user_id), list);
  }
  const dentists = dentistLoad.map((d) => ({
    dentistId: String(d.id),
    dentistName: String(d.name),
    bookedMinutes: Number(d.booked_minutes || 0),
  }));
  const maxBooked = Math.max(1, ...dentists.map((d) => d.bookedMinutes));
  const busyByDentist = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!b.dentistId) continue;
    const list = busyByDentist.get(b.dentistId) || [];
    list.push(b);
    busyByDentist.set(b.dentistId, list);
  }

  const unassigned = buildUnassignedDentistMoves(bookings, (b) => {
    const weekday = weekdayOf(b.date);
    const end = b.startMinutes + b.durationMinutes;
    const free = dentists.filter((d) => {
      if (onLeave.get(d.dentistId)?.some((r) => b.date >= r.start && b.date <= r.end)) return false;
      const blocks = shifts.filter((s) => s.user_id === d.dentistId && Number(s.weekday) === weekday);
      const covers = blocks.some(
        (s) => b.startMinutes >= toMinutes(String(s.start_time)) && end <= toMinutes(String(s.end_time)),
      );
      if (!covers) return false;
      const clash = (busyByDentist.get(d.dentistId) || []).some(
        (o) => o.date === b.date && b.startMinutes < o.startMinutes + o.durationMinutes && end > o.startMinutes,
      );
      return !clash;
    });
    if (!free.length) return null;
    // Menos ocupado primeiro — é isso que "maximizar a utilização" significa ao
    // nível do dentista: espalhar, não concentrar.
    free.sort((a, z) => a.bookedMinutes - z.bookedMinutes);
    const pick = free[0];
    return {
      dentistId: pick.dentistId,
      dentistName: pick.dentistName,
      utilizationPct: Math.round((pick.bookedMinutes / maxBooked) * 100),
    };
  });

  // ─── Regra 3: cadeira equipada ocupada sem necessidade ───────────────────
  const tagsByChair = new Map<number, string[]>();
  for (const e of equipment) {
    const chair = Number(e.chair);
    const tags = ((e.tags as string[] | null) || []).map(String);
    tagsByChair.set(chair, [...(tagsByChair.get(chair) || []), ...tags]);
  }
  // Uma etiqueta é escassa quando existe em exatamente uma cadeira — se houver
  // duas, ocupar uma não bloqueia ninguém.
  const chairsWithTag = new Map<string, number[]>();
  for (const [chair, tags] of tagsByChair) {
    for (const tag of new Set(tags)) {
      chairsWithTag.set(tag, [...(chairsWithTag.get(tag) || []), chair]);
    }
  }
  const scarceTags = new Set([...chairsWithTag.entries()].filter(([, chairs]) => chairs.length === 1).map(([t]) => t));
  // Só vale a pena libertar uma cadeira escassa se algum tipo de tratamento a
  // exigir de facto — senão a etiqueta é decorativa.
  const demandedTags = new Set(APPOINTMENT_TYPES.flatMap((t) => t.requiredEquipmentTags || []));

  const equipmentBlocks = buildEquipmentBlockMoves(bookings, (b) => {
    const chairTags = (tagsByChair.get(b.chair) || []).filter((t) => scarceTags.has(t) && demandedTags.has(t));
    if (!chairTags.length) return null;
    const needed = getAppointmentTypeOption(b.type)?.requiredEquipmentTags || [];
    // A consulta precisa mesmo de alguma delas? Então está no sítio certo.
    if (chairTags.some((t) => needed.includes(t))) return null;

    const end = b.startMinutes + b.durationMinutes;
    for (let chair = 1; chair <= chairCount; chair++) {
      if (chair === b.chair) continue;
      // A alternativa não pode ser outra cadeira escassa — trocar um bloqueio por
      // outro não é otimização.
      if ((tagsByChair.get(chair) || []).some((t) => scarceTags.has(t) && demandedTags.has(t))) continue;
      const busy = (bookingsByChairDay.get(`${b.date}|${chair}`) || []).some(
        (o) => b.startMinutes < o.startMinutes + o.durationMinutes && end > o.startMinutes,
      );
      if (!busy) return { tags: chairTags, alternativeChair: chair };
    }
    return null;
  });

  // ─── Regra 4: marcações contra as preferências do doente ─────────────────
  const patientIds = [...new Set(bookings.map((b) => b.patientId).filter((id): id is string => !!id))];
  const prefsByPatient = await getPreferencesForPatients(tenantId, patientIds);
  const preferenceMismatches = buildPreferenceMismatchMoves(bookings, (b) => {
    if (!b.patientId) return [];
    const prefs = prefsByPatient.get(b.patientId);
    if (!prefs) return [];
    return preferenceFit(prefs, {
      date: b.date,
      startMinutes: b.startMinutes,
      durationMinutes: b.durationMinutes,
      dentistId: b.dentistId,
    }).violations;
  });

  if (usedFallbackWindow) {
    warnings.push(
      'Alguns dias não têm turnos configurados — assumido 09:00–19:00. Definir horários da equipa torna estas propostas exatas.',
    );
  }

  const moves = rankMoves([...gapFill, ...unassigned, ...equipmentBlocks, ...preferenceMismatches]);

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    moves,
    totals: {
      moves: moves.length,
      recoverableMinutes: moves.reduce((sum, m) => sum + m.gainMinutes, 0),
    },
    warnings,
  };
}
