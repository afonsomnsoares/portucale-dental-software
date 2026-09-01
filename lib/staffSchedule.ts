import { query } from './db';
import {
  computeAvailability,
  detectCoverageGap,
  type RosterCoverageEntry,
  type ScheduleBlock,
  type TimeOffRange,
} from './staffAvailabilityCalc';

// Roles the clinic needs covered every day it's open — a coverage gap in any other role
// (admin, super_admin) isn't operationally urgent the same way.
const COVERAGE_ROLES = ['dentist', 'receptionist'];

export interface TeamRosterEntry {
  userId: string;
  userName: string;
  role: string;
  todayShifts: Array<{ startTime: string; endTime: string }>;
  onLeaveToday: boolean;
  workingNow: boolean | null; // null when `date` isn't today — "right now" doesn't apply
}

export interface TeamRoster {
  rows: TeamRosterEntry[];
  // Item 11's "identificação de capacidade disponível", as an alert: roles listed here
  // (see COVERAGE_ROLES) have nobody actually working that day (see
  // lib/staffAvailabilityCalc.ts's detectCoverageGap) — e.g. every dentist is on
  // approved leave and nobody's shift covers the gap.
  coverageWarnings: string[];
}

// One roster row per active user in the tenant, for a given calendar date — shift blocks
// for that weekday, whether an approved time-off range covers that date, and (only when
// `date` is today) whether they're inside a shift block at this exact moment. Simple CRUD
// on staff_schedules/staff_time_off lives inline in the route files (same convention as
// lib/recovery.ts vs. the plain-SQL routes elsewhere) — this is the one place signals from
// both tables get combined, via lib/staffAvailabilityCalc.ts.
export async function computeTeamRoster(tenantId: string, date: string): Promise<TeamRoster> {
  const target = new Date(`${date}T00:00:00`);
  const weekday = target.getDay();
  const todayStr = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, avoids the UTC/local mismatch toISOString would introduce
  const isToday = date === todayStr;

  const [users, shifts, timeOff] = await Promise.all([
    query(`SELECT id, name, role FROM users WHERE tenant_id=$1 AND active=TRUE ORDER BY name`, [tenantId]),
    query(`SELECT user_id, start_time, end_time FROM staff_schedules WHERE tenant_id=$1 AND weekday=$2`, [
      tenantId,
      weekday,
    ]),
    query(
      `SELECT user_id, start_date::text, end_date::text, status FROM staff_time_off
       WHERE tenant_id=$1 AND status='approved' AND start_date <= $2::date AND end_date >= $2::date`,
      [tenantId, date],
    ),
  ]);

  const shiftsByUser = new Map<string, ScheduleBlock[]>();
  for (const s of shifts) {
    const list = shiftsByUser.get(s.user_id) || [];
    list.push({ weekday, startTime: String(s.start_time).slice(0, 5), endTime: String(s.end_time).slice(0, 5) });
    shiftsByUser.set(s.user_id, list);
  }
  const leaveByUser = new Map<string, TimeOffRange[]>();
  for (const t of timeOff) {
    const list = leaveByUser.get(t.user_id) || [];
    list.push({ startDate: t.start_date, endDate: t.end_date, status: t.status });
    leaveByUser.set(t.user_id, list);
  }

  const now = new Date();
  const rows = users.map((u) => {
    const blocks = shiftsByUser.get(u.id) || [];
    const ranges = leaveByUser.get(u.id) || [];
    const onLeaveToday = ranges.length > 0; // already filtered to approved + covering `date`
    let workingNow: boolean | null = null;
    if (isToday) {
      workingNow = computeAvailability(blocks, ranges, now).available;
    }
    return {
      userId: u.id,
      userName: u.name,
      role: u.role,
      todayShifts: blocks.map((b) => ({ startTime: b.startTime, endTime: b.endTime })),
      onLeaveToday,
      workingNow,
    };
  });

  const coverageEntries: RosterCoverageEntry[] = rows.map((r) => ({
    role: r.role,
    hasShiftToday: r.todayShifts.length > 0,
    onLeaveToday: r.onLeaveToday,
  }));
  const coverageWarnings = detectCoverageGap(coverageEntries, COVERAGE_ROLES);

  return { rows, coverageWarnings };
}
