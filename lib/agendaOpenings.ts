import { query, queryOne } from './db';
import { type Booking, findOpenings, type Opening } from './scheduleOptimizerCalc';
import {
  addDays,
  freeIntervals,
  getWorkingWindows,
  isOnLeave,
  type ShiftLike,
  type TimeOffLike,
  toMinutes,
  weekdayOf,
} from './scheduling';

// A leitura da agenda que estava dentro de computeScheduleOptimization e que
// passou a ser precisa em dois sítios: o otimizador (que PROPÕE o que fazer com
// os espaços livres) e o Dynamic Scheduling (que os PREENCHE). São a mesma
// pergunta — "onde é que esta clínica tem cadeira parada, e quem a pode
// atender?" — e ter a resposta escrita duas vezes garantia que um dia divergiam.
//
// Nada aqui decide nada: é o retrato da agenda, sem regra de negócio nenhuma.

const FALLBACK_DAY_WINDOW = { openMinutes: 9 * 60, closeMinutes: 19 * 60 };

export interface SnapshotDentist {
  dentistId: string;
  dentistName: string;
  specialties: string[];
  bookedMinutes: number;
}

export interface AgendaSnapshot {
  today: string;
  toDate: string;
  days: number;
  chairCount: number;
  dateList: string[];
  bookings: Booking[];
  /** Chave `${date}|${chair}`. */
  bookingsByChairDay: Map<string, Booking[]>;
  openings: Opening[];
  dentists: SnapshotDentist[];
  shifts: Array<ShiftLike & { user_id: string }>;
  timeOff: Array<TimeOffLike & { user_id: string }>;
  /** Etiquetas de equipamento por cadeira — só de equipamento a funcionar. */
  tagsByChair: Map<number, string[]>;
  windowFor: (date: string) => { openMinutes: number; closeMinutes: number };
  warnings: string[];
}

export async function loadAgendaSnapshot(
  tenantId: string,
  days: number,
  minOpeningMinutes = 30,
): Promise<AgendaSnapshot> {
  const today = new Date().toLocaleDateString('en-CA');
  const toDate = addDays(today, Math.max(0, days - 1));
  const warnings: string[] = [];

  const [tenant, appts, equipment, shiftRows, timeOffRows, dentistRows] = await Promise.all([
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
    // status='operational' além de active, pela mesma razão que
    // lib/scheduling.ts já o fazia e o otimizador não: 'active' diz que o
    // equipamento está no catálogo, 'status' diz que funciona hoje. Uma cadeira
    // cujo raio-x está avariado não serve para uma avaliação radiográfica, e
    // oferecer lá uma manda o doente a uma consulta que não se pode fazer.
    query(
      `SELECT chair, tags FROM clinic_equipment
        WHERE tenant_id=$1 AND active=TRUE AND status='operational' AND chair IS NOT NULL`,
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
      `SELECT u.id, u.name, u.specialties, COALESCE(SUM(a.duration),0)::int AS booked_minutes
       FROM users u
       LEFT JOIN appointments a
         ON a.dentist_id = u.id AND a.tenant_id=$1
            AND a.appt_date BETWEEN $2::date AND $3::date AND a.status NOT IN ('no-show','departed')
       WHERE u.tenant_id=$1 AND u.role='dentist' AND u.active=TRUE
       GROUP BY u.id, u.name, u.specialties`,
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

  const bookingsByChairDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const key = `${b.date}|${b.chair}`;
    const list = bookingsByChairDay.get(key) || [];
    list.push(b);
    bookingsByChairDay.set(key, list);
  }

  // Janela de funcionamento por dia, a partir dos turnos reais da equipa.
  const shiftsByWeekday = new Map<number, Array<{ start: number; end: number }>>();
  for (const s of shiftRows) {
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

  const openings: Opening[] = [];
  for (const date of dateList) {
    const win = windowFor(date);
    for (let chair = 1; chair <= chairCount; chair++) {
      const dayBookings = bookingsByChairDay.get(`${date}|${chair}`);
      if (!dayBookings?.length) {
        // Uma cadeira-dia completamente vazia é uma ponta livre do tamanho do
        // dia inteiro — não passa por findOpenings, que precisa de pelo menos
        // uma marcação para saber de que cadeira/dia se trata.
        openings.push({
          chair,
          date,
          startMinutes: win.openMinutes,
          endMinutes: win.closeMinutes,
          durationMinutes: win.closeMinutes - win.openMinutes,
          kind: 'edge',
        });
        continue;
      }
      openings.push(...findOpenings(dayBookings, win, minOpeningMinutes));
    }
  }

  const tagsByChair = new Map<number, string[]>();
  for (const e of equipment) {
    const chair = Number(e.chair);
    const tags = ((e.tags as string[] | null) || []).map(String);
    tagsByChair.set(chair, [...(tagsByChair.get(chair) || []), ...tags]);
  }

  if (usedFallbackWindow) {
    warnings.push(
      'Alguns dias não têm turnos configurados — assumido 09:00–19:00. Definir horários da equipa torna estas propostas exatas.',
    );
  }

  return {
    today,
    toDate,
    days,
    chairCount,
    dateList,
    bookings,
    bookingsByChairDay,
    openings: openings.filter((o) => o.durationMinutes >= minOpeningMinutes),
    dentists: dentistRows.map((d) => ({
      dentistId: String(d.id),
      dentistName: String(d.name),
      specialties: ((d.specialties as string[] | null) || []).map(String),
      bookedMinutes: Number(d.booked_minutes || 0),
    })),
    shifts: shiftRows.map((s) => ({
      user_id: String(s.user_id),
      weekday: Number(s.weekday),
      start_time: String(s.start_time),
      end_time: String(s.end_time),
    })),
    timeOff: timeOffRows.map((t) => ({
      user_id: String(t.user_id),
      start_date: String(t.start_date),
      end_date: String(t.end_date),
    })),
    tagsByChair,
    windowFor,
    warnings,
  };
}

export interface AvailableDentist {
  dentistId: string;
  dentistName: string;
  specialties: string[];
  freeFrom: number;
  freeTo: number;
}

/**
 * Quem pode atender NESTE espaço: de turno nesse dia, não de férias, e com um
 * bloco livre que apanhe o espaço. `freeFrom`/`freeTo` é a interseção do bloco
 * livre do dentista com o espaço — quem pontua precisa de saber até onde pode
 * esticar a consulta, não só que "há alguém".
 *
 * Repare-se que a disponibilidade é do DENTISTA e o espaço é da CADEIRA: um
 * dentista livre a essa hora pode estar noutra cadeira ao mesmo tempo, e é por
 * isso que as marcações dele entram aqui como ocupação (freeIntervals) em vez
 * de se olhar só para a cadeira.
 */
export function dentistsForOpening(snapshot: AgendaSnapshot, opening: Opening, minDuration = 15): AvailableDentist[] {
  const weekday = weekdayOf(opening.date);
  const result: AvailableDentist[] = [];

  for (const d of snapshot.dentists) {
    const timeOff = snapshot.timeOff.filter((t) => t.user_id === d.dentistId);
    if (isOnLeave(opening.date, timeOff)) continue;

    const windows = getWorkingWindows(
      weekday,
      snapshot.shifts.filter((s) => s.user_id === d.dentistId),
    );
    if (!windows.length) continue;

    const busy = snapshot.bookings
      .filter((b) => b.dentistId === d.dentistId && b.date === opening.date)
      .map((b) => ({ start: b.startMinutes, end: b.startMinutes + b.durationMinutes }));

    for (const iv of freeIntervals(windows, busy, minDuration)) {
      const from = Math.max(iv.start, opening.startMinutes);
      const to = Math.min(iv.end, opening.endMinutes);
      if (to - from < minDuration) continue;
      result.push({
        dentistId: d.dentistId,
        dentistName: d.dentistName,
        specialties: d.specialties,
        freeFrom: from,
        freeTo: to,
      });
      break; // um bloco por dentista chega — é o que apanha este espaço
    }
  }

  // Menos ocupado primeiro: "maximizar a utilização" ao nível do dentista é
  // espalhar, não concentrar (mesma ordem do otimizador para as consultas sem
  // dentista atribuído).
  const loadOf = new Map(snapshot.dentists.map((d) => [d.dentistId, d.bookedMinutes]));
  return result.sort((a, b) => (loadOf.get(a.dentistId) || 0) - (loadOf.get(b.dentistId) || 0));
}
