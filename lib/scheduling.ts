// getDefaultDuration/APPOINTMENT_TYPES live in lib/constants.ts, not here —
// this module imports `query()` (server-only, pulls in `pg`), so anything
// exported from it is unsafe for a 'use client' component to import. The
// booking modal (app/dashboard/receptionist/page.tsx) needs the type list on
// the client; the suggestion engine below needs the same duration lookup —
// both get it from the shared, browser-safe constants file instead of it
// living in one place and being duplicated in the other.
import { getAppointmentTypeOption, getDefaultDuration } from './constants';
import { query } from './db';
import type { SuggestedSlot, SuggestSlotsResult } from './types/scheduling';

export { APPOINTMENT_TYPES, DEFAULT_APPOINTMENT_DURATION, getDefaultDuration } from './constants';

export const SLOT_GRID_MINUTES = 15;
export const DEFAULT_SUGGEST_DAYS = 7;
export const DEFAULT_SUGGEST_LIMIT = 5;

// ─── Pure time-math helpers (minutes since midnight) ────────────────────────

export interface TimeWindow {
  start: number;
  end: number;
}

export function toMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

export interface ShiftLike {
  weekday: number;
  start_time: string;
  end_time: string;
}

// A dentist's working windows on a given weekday, from their staff_schedules
// rows — supports split shifts (more than one row for the same weekday).
export function getWorkingWindows(weekday: number, shifts: ShiftLike[]): TimeWindow[] {
  return shifts
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ start: toMinutes(s.start_time), end: toMinutes(s.end_time) }))
    .sort((a, b) => a.start - b.start);
}

export interface TimeOffLike {
  start_date: string;
  end_date: string;
}

export function isOnLeave(date: string, timeOff: TimeOffLike[]): boolean {
  return timeOff.some((t) => t.start_date <= date && date <= t.end_date);
}

// Subtracts already-booked intervals from a set of working windows, keeping
// only the free spans that are at least `minDuration` minutes long.
export function freeIntervals(windows: TimeWindow[], busy: TimeWindow[], minDuration: number): TimeWindow[] {
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);
  const free: TimeWindow[] = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of sortedBusy) {
      const bs = Math.max(b.start, w.start);
      const be = Math.min(b.end, w.end);
      if (be <= bs) continue; // this busy interval doesn't touch the window
      if (bs > cursor && bs - cursor >= minDuration) free.push({ start: cursor, end: bs });
      cursor = Math.max(cursor, be);
    }
    if (w.end - cursor >= minDuration) free.push({ start: cursor, end: w.end });
  }
  return free;
}

// Discrete candidate start times inside a free interval, snapped to a grid
// (default 15 min) so suggestions land on tidy clock times.
export function generateSlotStarts(interval: TimeWindow, duration: number, grid = SLOT_GRID_MINUTES): number[] {
  const starts: number[] = [];
  let t = Math.ceil(interval.start / grid) * grid;
  while (t + duration <= interval.end) {
    starts.push(t);
    t += grid;
  }
  return starts;
}

export interface ChairBooking {
  chair: number;
  start: number;
  end: number;
}

// Same idea as the client-side pickAutoChair (previously only in
// app/dashboard/receptionist/page.tsx, used just for "now") generalized to
// any candidate time — first chair (1..chairCount) with no overlapping
// booking. Returns null if every chair is taken at that time.
export function pickFreeChair(
  existing: ChairBooking[],
  candidateStart: number,
  duration: number,
  chairCount: number,
  // When set, only these chairs are considered — used to require a chair that carries the
  // equipment an appointment type needs (clinic_equipment.tags, see requiredEquipmentTags
  // in lib/constants.ts). null/undefined = no restriction (today's behavior).
  allowedChairs?: Set<number> | null,
): number | null {
  const candidateEnd = candidateStart + duration;
  for (let chair = 1; chair <= Math.max(1, chairCount); chair++) {
    if (allowedChairs && !allowedChairs.has(chair)) continue;
    const conflict = existing.some((b) => b.chair === chair && candidateStart < b.end && candidateEnd > b.start);
    if (!conflict) return chair;
  }
  return null;
}

export interface SlotCandidate {
  dentistId: string;
  dentistName: string;
  chair: number;
  date: string;
  startMinutes: number;
}

// Earliest-first, but a candidate that falls on a day the patient already has
// another appointment is boosted ahead of an earlier-but-isolated one — the
// "agrupar/coordenar consultas do mesmo paciente" heuristic.
export function rankSlotCandidates(
  candidates: SlotCandidate[],
  opts: { patientAppointmentDates?: string[] } = {},
): SlotCandidate[] {
  const preferredDates = new Set(opts.patientAppointmentDates || []);
  return [...candidates].sort((a, b) => {
    const aBoost = preferredDates.has(a.date) ? 0 : 1;
    const bBoost = preferredDates.has(b.date) ? 0 : 1;
    if (aBoost !== bBoost) return aBoost - bBoost;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startMinutes - b.startMinutes;
  });
}

// ─── Orchestration (touches the DB — not covered by unit tests) ────────────

export interface SuggestSlotsParams {
  tenantId: string;
  type: string;
  duration?: number;
  patientId?: string;
  preferredDentistId?: string;
  fromDate?: string;
  days?: number;
  limit?: number;
}

export async function suggestAppointmentSlots(params: SuggestSlotsParams): Promise<SuggestSlotsResult> {
  const { tenantId, type, patientId, preferredDentistId } = params;
  const duration = params.duration ?? getDefaultDuration(type);
  const fromDate = params.fromDate || new Date().toISOString().slice(0, 10);
  const days = params.days ?? DEFAULT_SUGGEST_DAYS;
  const limit = params.limit ?? DEFAULT_SUGGEST_LIMIT;
  const toDate = addDays(fromDate, Math.max(0, days - 1));
  const typeOption = getAppointmentTypeOption(type);
  const warnings: string[] = [];

  const [tenant, allDentists, equipment] = await Promise.all([
    query('SELECT operatories FROM tenants WHERE id=$1', [tenantId]),
    preferredDentistId
      ? query(
          `SELECT id, name, specialties FROM users WHERE id=$1 AND role='dentist' AND active=TRUE AND tenant_id=$2`,
          [preferredDentistId, tenantId],
        )
      : query(
          `SELECT id, name, specialties FROM users WHERE role='dentist' AND active=TRUE AND tenant_id=$1 ORDER BY name`,
          [tenantId],
        ),
    query(`SELECT chair, tags FROM clinic_equipment WHERE tenant_id=$1 AND active=TRUE AND chair IS NOT NULL`, [
      tenantId,
    ]),
  ]);
  if (!allDentists.length) return { duration, slots: [], warnings };

  // "Encontrar dentista adequado" — when the type requires a specialty and nobody was
  // explicitly requested, prefer dentists who have it. Best-effort: an unfilled
  // requirement degrades to "show everyone" (with a warning) rather than an empty result,
  // same spirit as the rest of this engine (see freeIntervals/pickFreeChair above).
  let dentists = allDentists;
  if (!preferredDentistId && typeOption?.requiredSpecialty) {
    const specialty = typeOption.requiredSpecialty;
    const matching = allDentists.filter((d) => (d.specialties as string[] | null)?.includes(specialty));
    if (matching.length) {
      dentists = matching;
    } else {
      warnings.push(`Nenhum dentista com a especialidade "${specialty}" — a mostrar todos os dentistas.`);
    }
  }

  const chairCount = Math.max(1, Number(tenant[0]?.operatories) || 3);

  // "Encontrar equipamento necessário" — restrict to chairs carrying every required tag.
  // Same best-effort fallback: no chair has it → don't filter, just warn.
  let allowedChairs: Set<number> | null = null;
  if (typeOption?.requiredEquipmentTags?.length) {
    const required = typeOption.requiredEquipmentTags;
    const matchingChairs = equipment
      .filter((e) => required.every((tag) => ((e.tags as string[] | null) || []).includes(tag)))
      .map((e) => Number(e.chair));
    if (matchingChairs.length) {
      allowedChairs = new Set(matchingChairs);
    } else {
      warnings.push(
        `Nenhuma cadeira com o equipamento necessário (${required.join(', ')}) — a mostrar todas as cadeiras.`,
      );
    }
  }

  const dentistIds = dentists.map((d) => d.id as string);
  const dateList = Array.from({ length: days }, (_, i) => addDays(fromDate, i));

  const [shifts, timeOff, appts, patientAppts] = await Promise.all([
    query(
      `SELECT user_id, weekday, start_time, end_time FROM staff_schedules WHERE tenant_id=$1 AND user_id = ANY($2::uuid[])`,
      [tenantId, dentistIds],
    ),
    query(
      `SELECT user_id, start_date::text AS start_date, end_date::text AS end_date
       FROM staff_time_off
       WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND status='approved' AND end_date >= $3::date`,
      [tenantId, dentistIds, fromDate],
    ),
    query(
      `SELECT dentist_id, chair, appt_date::text AS appt_date, start_time, duration
       FROM appointments
       WHERE tenant_id=$1 AND appt_date BETWEEN $2::date AND $3::date`,
      [tenantId, fromDate, toDate],
    ),
    patientId
      ? query(
          `SELECT appt_date::text AS appt_date FROM appointments WHERE tenant_id=$1 AND patient_id=$2 AND appt_date >= $3::date`,
          [tenantId, patientId, fromDate],
        )
      : Promise.resolve([]),
  ]);

  const patientAppointmentDates = patientAppts.map((r) => r.appt_date as string);
  const candidates: SlotCandidate[] = [];

  for (const dentist of dentists) {
    const dentistShifts = shifts.filter((s) => s.user_id === dentist.id) as ShiftLike[];
    const dentistTimeOff = timeOff.filter((t) => t.user_id === dentist.id) as TimeOffLike[];

    for (const date of dateList) {
      if (isOnLeave(date, dentistTimeOff)) continue;
      const windows = getWorkingWindows(weekdayOf(date), dentistShifts);
      if (!windows.length) continue;

      const busyForDentist: TimeWindow[] = appts
        .filter((a) => a.dentist_id === dentist.id && a.appt_date === date)
        .map((a) => ({ start: toMinutes(a.start_time), end: toMinutes(a.start_time) + Number(a.duration || 30) }));
      const free = freeIntervals(windows, busyForDentist, duration);

      // Chair occupancy across the whole clinic that day — grown as we tentatively
      // place candidates below, so two suggestions in the same run never claim the
      // same chair at an overlapping time.
      const dayBookings: ChairBooking[] = appts
        .filter((a) => a.appt_date === date)
        .map((a) => ({
          chair: Number(a.chair),
          start: toMinutes(a.start_time),
          end: toMinutes(a.start_time) + Number(a.duration || 30),
        }));

      for (const interval of free) {
        for (const start of generateSlotStarts(interval, duration)) {
          const chair = pickFreeChair(dayBookings, start, duration, chairCount, allowedChairs);
          if (chair == null) continue;
          candidates.push({ dentistId: dentist.id, dentistName: dentist.name, chair, date, startMinutes: start });
          dayBookings.push({ chair, start, end: start + duration });
        }
      }
    }
  }

  const top = rankSlotCandidates(candidates, { patientAppointmentDates }).slice(0, limit);
  const slots: SuggestedSlot[] = top.map((c) => ({
    dentistId: c.dentistId,
    dentistName: c.dentistName,
    chair: c.chair,
    date: c.date,
    startTime: minutesToTime(c.startMinutes),
  }));
  return { duration, slots, warnings };
}
