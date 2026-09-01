// Pure helpers for staff availability — no DB imports, unit-testable like
// lib/lifecycleCalc.ts. Turns a weekly recurring schedule + approved time-off ranges into
// "is this person available right now" — used both by lib/staffSchedule.ts's team roster
// aggregate and (potentially, later) anything that needs to know who's free.

export interface ScheduleBlock {
  weekday: number; // 0=Sunday..6=Saturday, matches JS Date#getDay()
  startTime: string; // 'HH:MM' or 'HH:MM:SS'
  endTime: string;
}

export interface TimeOffRange {
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;
  status: string;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// True when `at` falls inside any of the person's recurring weekly shift blocks for that
// weekday. A shift never crosses midnight (enforced at the DB level too), so this is a
// same-day interval check, no wraparound to handle.
export function isOnShift(blocks: ScheduleBlock[], at: Date): boolean {
  const weekday = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();
  return blocks.some((b) => {
    if (b.weekday !== weekday) return false;
    return minutes >= toMinutes(b.startTime) && minutes < toMinutes(b.endTime);
  });
}

// True when `dateStr` falls inside an *approved* time-off range — pending/rejected/
// cancelled requests never block availability, only an approved one does.
export function isOnApprovedLeave(ranges: TimeOffRange[], dateStr: string): boolean {
  return ranges.some((r) => r.status === 'approved' && dateStr >= r.startDate && dateStr <= r.endDate);
}

export interface Availability {
  onShift: boolean;
  onLeave: boolean;
  available: boolean;
}

// Local-calendar-day string (not toISOString, which is UTC and can disagree with
// getDay()/getHours() above near midnight in timezones ahead of UTC) — keeps the shift
// check and the leave check reading the same "today" consistently.
function localDateStr(at: Date) {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeAvailability(blocks: ScheduleBlock[], ranges: TimeOffRange[], at: Date): Availability {
  const onShift = isOnShift(blocks, at);
  const onLeave = isOnApprovedLeave(ranges, localDateStr(at));
  return { onShift, onLeave, available: onShift && !onLeave };
}

// Item 11's "identificação de capacidade disponível" turned into an alert: not just
// showing who's working, but flagging when a role the clinic actually staffs has *nobody*
// covering it today. lib/staffSchedule.ts's computeTeamRoster already has every input
// this needs (per-user role, today's shift blocks, onLeaveToday) — this stays a pure leaf
// function so it's unit-testable without a DB, same convention as the rest of this file.
export interface RosterCoverageEntry {
  role: string;
  hasShiftToday: boolean; // has at least one recurring shift block for today's weekday
  onLeaveToday: boolean;
}

// A role with nobody on the roster at all isn't "a gap today" — that's a staffing
// decision (e.g. a clinic that has no receptionist role at all), out of scope here. Only
// roles that DO have at least one person, but where every one of them is either off-shift
// or on approved leave today, get flagged.
export function detectCoverageGap(entries: RosterCoverageEntry[], rolesToCheck: string[]): string[] {
  const warnings: string[] = [];
  for (const role of rolesToCheck) {
    const roleEntries = entries.filter((e) => e.role === role);
    if (!roleEntries.length) continue;
    const covered = roleEntries.some((e) => e.hasShiftToday && !e.onLeaveToday);
    if (!covered) warnings.push(role);
  }
  return warnings;
}
