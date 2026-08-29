// Pure matching logic for the waitlist engine — no DB imports so it is unit-testable.
// lib/waitlist.ts wraps this with the actual DB reads/writes.

export interface WaitlistCandidate {
  id: string;
  patient_id: string;
  preferred_dentist_id: string | null;
  preferred_days: number[] | null; // 0=Sunday .. 6=Saturday, null/[] = any day
  preferred_time_start: string | null; // 'HH:MM' or null = any time
  preferred_time_end: string | null;
  min_duration: number;
  max_wait_until: string | null; // date, null = no cap
  status: string;
  created_at: string;
}

export interface FreedSlot {
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  duration: number;
  dentistId: string | null;
  chair: number;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function matchesSlot(candidate: WaitlistCandidate, slot: FreedSlot, now = new Date()) {
  if (candidate.status !== 'active') return false;
  if (candidate.min_duration > slot.duration) return false;
  if (candidate.preferred_dentist_id && candidate.preferred_dentist_id !== slot.dentistId) return false;

  if (candidate.max_wait_until && slot.date > candidate.max_wait_until) return false;
  if (slot.date < now.toISOString().slice(0, 10)) return false;

  const weekday = new Date(`${slot.date}T00:00:00Z`).getUTCDay();
  if (candidate.preferred_days?.length && !candidate.preferred_days.includes(weekday)) return false;

  if (candidate.preferred_time_start || candidate.preferred_time_end) {
    const slotStart = toMinutes(slot.startTime);
    const slotEnd = slotStart + slot.duration;
    const prefStart = candidate.preferred_time_start ? toMinutes(candidate.preferred_time_start) : 0;
    const prefEnd = candidate.preferred_time_end ? toMinutes(candidate.preferred_time_end) : 24 * 60;
    // The offered appointment must fit entirely within the preferred window.
    if (slotStart < prefStart || slotEnd > prefEnd) return false;
  }

  return true;
}

// Ranks matching candidates FIFO (earliest opt-in first) — simple, explicit MVP criterion.
export function rankCandidates(candidates: WaitlistCandidate[], slot: FreedSlot, now = new Date(), limit = 3) {
  return candidates
    .filter((c) => matchesSlot(c, slot, now))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, limit);
}
