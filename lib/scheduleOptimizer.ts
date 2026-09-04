import { type AgendaSnapshot, loadAgendaSnapshot } from './agendaOpenings';
import { APPOINTMENT_TYPES, getAppointmentTypeOption } from './constants';
import { query } from './db';
import {
  buildEquipmentBlockMoves,
  buildGapFillMoves,
  buildPreferenceMismatchMoves,
  buildUnassignedDentistMoves,
  type OptimizerMove,
  rankMoves,
  waitlistFitsOpening,
} from './scheduleOptimizerCalc';
import { minutesToTime, toMinutes, weekdayOf } from './scheduling';
import { getPreferencesForPatients } from './schedulingPrefs';
import { preferenceFit } from './schedulingPrefsCalc';

// Item 9 — "otimizar: dentista + cadeira + paciente + horário / maximizar a
// utilização da capacidade disponível". lib/scheduleIntel.ts já mede a agenda;
// isto propõe o que fazer com a medição. A lógica de decisão vive toda em
// lib/scheduleOptimizerCalc.ts (pura, testada) e a leitura da agenda em
// lib/agendaOpenings.ts (partilhada com o Dynamic Scheduling); aqui só se ligam
// os sinais.
//
// Nada é executado automaticamente. Este módulo PROPÕE — mover uma consulta que
// já existe obriga a avisar o doente, e essa é uma decisão de quem atende. Quem
// preenche espaços vazios sozinho (que é outra coisa: ninguém é desmarcado) é
// lib/dynamicScheduling.ts, e só até onde a política da clínica deixar.

const DEFAULT_WINDOW_DAYS = 14;
// Só se propõe encaixar alguém num espaço a partir desta duração — abaixo disto
// não cabe nenhum tratamento real (a consulta mais curta em APPOINTMENT_TYPES são
// 15 min) e a lista encheria-se de ruído.
const MIN_USEFUL_OPENING_MINUTES = 30;

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
  const snapshot = await loadAgendaSnapshot(tenantId, days, MIN_USEFUL_OPENING_MINUTES);
  const { today, bookings, bookingsByChairDay, chairCount, openings, tagsByChair } = snapshot;
  const warnings = [...snapshot.warnings];

  const waitlist = await query(
    `SELECT w.id, w.min_duration, w.preferred_days, w.treatment_type, w.status,
            w.preferred_time_start::text, w.preferred_time_end::text, w.max_wait_until::text,
            COALESCE(p.name,'—') AS patient_name
     FROM waitlist_entries w
     LEFT JOIN patients p ON p.id = w.patient_id
     WHERE w.tenant_id=$1 AND w.status='active'
     ORDER BY w.created_at`,
    [tenantId],
  );

  // ─── Regra 1: buracos preenchíveis pela lista de espera ──────────────────
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
    openings,
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
  for (const t of snapshot.timeOff) {
    const list = onLeave.get(t.user_id) || [];
    list.push({ start: t.start_date, end: t.end_date });
    onLeave.set(t.user_id, list);
  }
  const maxBooked = Math.max(1, ...snapshot.dentists.map((d) => d.bookedMinutes));
  const busyByDentist = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!b.dentistId) continue;
    const list = busyByDentist.get(b.dentistId) || [];
    list.push(b);
    busyByDentist.set(b.dentistId, list);
  }

  const unassigned = buildUnassignedDentistMoves(bookings, (b) => {
    const weekday = weekdayOf(b.date);
    const end = b.startMinutes + b.durationMinutes;
    const free = snapshot.dentists.filter((d) => {
      if (onLeave.get(d.dentistId)?.some((r) => b.date >= r.start && b.date <= r.end)) return false;
      const blocks = snapshot.shifts.filter((s) => s.user_id === d.dentistId && s.weekday === weekday);
      const covers = blocks.some((s) => b.startMinutes >= toMinutes(s.start_time) && end <= toMinutes(s.end_time));
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

export type { AgendaSnapshot };
